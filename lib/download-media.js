const fs = require('fs').promises;
const path = require('path');
const { executeWithTimeoutAndRetry, calculateTimeout } = require('./retry');
const {
    MEDIA_EXTENSIONS,
    BYTES_PER_MB,
    OUTPUT_DIRS,
    PROGRESS_THRESHOLD_BYTES,
} = require('./constants');

/**
 * Media downloader for Telegram messages
 * Handles downloading and processing of various media types
 *
 * @module telegram/download-media
 */

/**
 * Get file extension for media based on message type
 * @param {Object} message - Telegram message object
 * @returns {string} File extension
 */
function getMediaExtension(message) {
    if (message.photo) {
        return MEDIA_EXTENSIONS.PHOTO;
    } else if (message.video) {
        return MEDIA_EXTENSIONS.VIDEO;
    } else if (message.document) {
        const fileName = message.document.fileName || 'document';
        const parts = fileName.split('.');
        return parts.length > 1 ? parts[parts.length - 1] : MEDIA_EXTENSIONS.DEFAULT;
    } else if (message.audio) {
        return MEDIA_EXTENSIONS.AUDIO;
    }
    return MEDIA_EXTENSIONS.DEFAULT;
}

/**
 * Get estimated file size for timeout calculation
 * @param {Object} message - Telegram message object
 * @returns {number} Estimated file size in bytes
 */
function getEstimatedFileSize(message) {
    if (message.document && message.document.size) {
        return message.document.size;
    } else if (message.video && message.video.size) {
        return message.video.size;
    } else if (message.photo && message.photo.sizes && message.photo.sizes.length > 0) {
        // Use largest photo size
        const largestSize = message.photo.sizes.reduce((prev, current) =>
            (prev.size > current.size) ? prev : current);
        return largestSize.size || 0;
    }
    return 0;
}

/**
 * Create media file information object
 * @param {Object} message - Telegram message object
 * @param {string} fileName - Media file name
 * @param {string} filePath - Full file path
 * @param {string} sectionDir - Section directory path
 * @returns {Object} Media file information
 */
function createMediaFileInfo(message, fileName, filePath, sectionDir) {
    return {
        type: message.media.className.replace('MessageMedia', '').toLowerCase(),
        fileId: message.id,
        fileName,
        localPath: path.relative(sectionDir, filePath),
    };
}

/**
 * Download media from message with timeout and retry
 * @param {Object} client - Telegram client instance
 * @param {Object} message - Telegram message object
 * @param {string} sectionDir - Section directory path
 * @param {Object} downloadConfig - Download configuration
 * @param {Object} stats - Statistics tracker
 * @param {Object} sectionStats - Section statistics tracker
 * @param {Function} logFn - Logging function
 * @returns {Promise<Array>} Array of media file information
 */
async function downloadMedia(
    client,
    message,
    sectionDir,
    downloadConfig,
    stats,
    sectionStats = null,
    logFn = console.log,
) {
    if (!message.media) return [];

    const mediaDir = path.join(sectionDir, OUTPUT_DIRS.media);
    try {
        await fs.access(mediaDir);
    } catch {
        await fs.mkdir(mediaDir, { recursive: true });
    }

    const mediaFiles = [];

    // Check if media already exists
    const extension = getMediaExtension(message);
    const fileName = `${message.id}.${extension}`;
    const filePath = path.join(mediaDir, fileName);

    try {
        await fs.access(filePath);
        // Media already exists, skip download
        const fileStats = await fs.stat(filePath);
        logFn(`  Media already exists: ${fileName} (${Math.round(fileStats.size / BYTES_PER_MB)}MB)`);
        stats.incrementMedia('skipped', fileStats.size);
        if (sectionStats) {
            sectionStats.addCachedBytes(fileStats.size);
        }

        mediaFiles.push(createMediaFileInfo(message, fileName, filePath, sectionDir));
        return mediaFiles;
    } catch {
        // File doesn't exist, continue with download
    }

    // Download with timeout and retry using new retry utility
    let buffer = null;
    const fileSizeBytes = getEstimatedFileSize(message);

    // Calculate timeout based on file size
    const timeoutMs = calculateTimeout(
        fileSizeBytes,
        downloadConfig.timeoutBaseMs,
        downloadConfig.timeoutPerMbMs,
        downloadConfig.timeoutMaxMs,
    );

    // Ensure timeout is at least the base timeout and is an integer
    const finalTimeoutMs = Math.max(Math.round(timeoutMs), downloadConfig.timeoutBaseMs);

    try {
        logFn(`  Downloading media ${fileName} (${Math.round(fileSizeBytes / BYTES_PER_MB)}MB)...`);

        // Optimize download options for better performance
        const downloadOptions = {
            workers: 1, // Use single worker for better reliability
            progressCallback: fileSizeBytes > PROGRESS_THRESHOLD_BYTES ? (progress) => {
                // Show progress for files larger than 10MB
                const percent = Math.round((progress / fileSizeBytes) * 100);
                if (percent % 25 === 0) { // Log every 25%
                    logFn(`  Download progress: ${percent}%`);
                }
            } : undefined,
        };

        buffer = await executeWithTimeoutAndRetry(
            () => {
                // Check if client supports download options
                if (client.downloadMedia.length > 1) {
                    return client.downloadMedia(message, downloadOptions);
                } else {
                    // For backward compatibility or simple clients
                    return client.downloadMedia(message);
                }
            },
            finalTimeoutMs,
            {
                maxRetries: downloadConfig.maxRetries,
                baseDelayMs: downloadConfig.retryDelayBaseMs,
                maxDelayMs: downloadConfig.retryDelayMaxMs,
                jitterMs: downloadConfig.retryJitterMs,
                shouldRetry: (error, _attempt, _errorType) => {
                    // Don't retry "not implemented" errors
                    return error.message !== 'not implemented';
                },
                onRetry: (error, attempt, delay, _errorType) => {
                    logFn(`  Download attempt ${attempt + 1} failed: ${error.message}`);
                    logFn(
                        `  Retrying... (${downloadConfig.maxRetries - attempt} attempts left, ` +
                        `delay: ${Math.round(delay / 1000)}s)`,
                    );
                },
            },
        );
    } catch (err) {
        // Handle "not implemented" errors gracefully
        // Check both direct error message and wrapped error message from retry mechanism
        if (err.message === 'not implemented' || err.message.includes('not implemented')) {
            logFn(`  Media type not supported: ${message.media.className}`);
            stats.incrementMedia('skipped');
            return [];
        }

        logFn(
            `  Failed to download media ${fileName} after ${downloadConfig.maxRetries} ` +
            `attempts: ${err.message}`,
        );
        stats.incrementMedia('failed');
        stats.addError(err, 'media-download', { fileName, messageId: message.id });
        return [];
    }

    // Save the downloaded buffer
    try {
        await fs.writeFile(filePath, buffer);
        logFn(`  Media saved: ${fileName} (${Math.round(buffer.length / BYTES_PER_MB)}MB)`);
        stats.incrementMedia('downloaded', buffer.length);
        if (sectionStats) {
            sectionStats.addNewBytes(buffer.length);
        }

        mediaFiles.push(createMediaFileInfo(message, fileName, filePath, sectionDir));
    } catch (writeErr) {
        logFn(`  Failed to save media ${fileName}: ${writeErr.message}`);
        stats.incrementMedia('failed');
        stats.addError(writeErr, 'media-download', { fileName, messageId: message.id });
        return [];
    }

    return mediaFiles;
}

/**
 * Process media information for message JSON
 * @param {Object} client - Telegram client instance
 * @param {Object} message - Telegram message object
 * @param {string} sectionDir - Section directory path
 * @param {Object} downloadConfig - Download configuration
 * @param {Object} stats - Statistics tracker
 * @param {Object} sectionStats - Section statistics tracker
 * @param {Function} logFn - Logging function
 * @returns {Promise<Array>} Array of media file information
 */
async function processMessageMedia(
    client,
    message,
    sectionDir,
    downloadConfig,
    stats,
    sectionStats = null,
    logFn = console.log,
) {
    // Download media if present
    if (message.media) {
        return await downloadMedia(
            client,
            message,
            sectionDir,
            downloadConfig,
            stats,
            sectionStats,
            logFn,
        );
    }
    return [];
}

module.exports = {
    downloadMedia,
    processMessageMedia,
    getMediaExtension,
    getEstimatedFileSize,
    createMediaFileInfo,
};

