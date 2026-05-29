/**
 * Media copier for Telegram downloads
 * Copies media files from downloaded directory to site content directory
 *
 * @module media-copier
 */

const fs = require('fs');
const path = require('path');

/**
 * Copy media file from source to target directory
 * @param {string} sourcePath - Source file path
 * @param {string} targetDir - Target directory path
 * @param {Object} options - Copy options
 * @param {string} options.rename - New filename (optional)
 * @param {boolean} options.overwrite - Overwrite existing file (default: false)
 * @returns {Promise<Object>} Result with targetPath and relativePath
 */
async function copyMedia(sourcePath, targetDir, options = {}) {
    const {
        rename = null,
        overwrite = false,
    } = options;

    if (!sourcePath) {
        throw new Error('Source path is required');
    }

    if (!targetDir) {
        throw new Error('Target directory is required');
    }

    // Check if source file exists
    try {
        await fs.promises.access(sourcePath, fs.constants.R_OK);
    } catch (error) {
        throw new Error(`Source file not found or not readable: ${sourcePath}`);
    }

    // Ensure target directory exists
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Determine target filename
    const sourceFilename = path.basename(sourcePath);
    const targetFilename = rename || sourceFilename;
    const targetPath = path.join(targetDir, targetFilename);

    // Check if target file already exists
    if (!overwrite) {
        try {
            await fs.promises.access(targetPath, fs.constants.F_OK);
            // File exists and overwrite is false
            return {
                targetPath,
                relativePath: targetFilename,
                skipped: true,
            };
        } catch {
            // File doesn't exist, proceed with copy
        }
    }

    // Copy file
    await fs.promises.copyFile(sourcePath, targetPath);

    return {
        targetPath,
        relativePath: targetFilename,
        skipped: false,
    };
}

/**
 * Copy multiple media files
 * @param {Array} mediaList - Array of media objects with sourcePath
 * @param {string} targetDir - Target directory path
 * @param {Object} options - Copy options
 * @returns {Promise<Array>} Array of copy results
 */
async function copyMediaBatch(mediaList, targetDir, options = {}) {
    if (!mediaList || mediaList.length === 0) {
        return [];
    }

    const results = [];

    for (const media of mediaList) {
        try {
            const result = await copyMedia(media.sourcePath, targetDir, {
                ...options,
                rename: media.rename || options.rename,
            });
            results.push({
                ...result,
                media,
            });
        } catch (error) {
            results.push({
                media,
                error: error.message,
                skipped: true,
            });
        }
    }

    return results;
}

/**
 * Generate media filename from message ID and media type
 * @param {number} messageId - Telegram message ID
 * @param {string} mediaType - Media type (photo, video, document)
 * @param {string} extension - File extension
 * @returns {string} Generated filename
 */
function generateMediaFilename(messageId, mediaType, extension) {
    if (!messageId) {
        throw new Error('Message ID is required');
    }

    const ext = extension ? extension.replace(/^\./, '') : 'jpg';
    return `${messageId}-${mediaType}.${ext}`;
}

/**
 * Get file extension from path
 * @param {string} filePath - File path
 * @returns {string} File extension (without dot)
 */
function getFileExtension(filePath) {
    const ext = path.extname(filePath);
    return ext ? ext.substring(1) : '';
}

module.exports = {
    copyMedia,
    copyMediaBatch,
    generateMediaFilename,
    getFileExtension,
};
