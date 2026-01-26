const fs = require('fs').promises;
const path = require('path');
const { TelegramParser } = require('./parser');
const { OUTPUT_DIRS } = require('./constants');
const { processMessageMedia } = require('./download-media');

/**
 * Message processor for Telegram messages
 * Handles conversion to JSON format and downloading of messages
 *
 * @module telegram/download-message
 */

/**
 * Convert Telegram message to JSON format with media download
 * @param {Object} client - Telegram client instance
 * @param {Object} message - Telegram message object
 * @param {string} sectionDir - Section directory for media storage
 * @param {Object} downloadConfig - Download configuration
 * @param {Object} stats - Statistics tracker
 * @param {Object} [sectionStats] - Section statistics tracker
 * @param {Object} scraper - Web scraper instance
 * @param {Function} logFn - Logging function
 * @returns {Promise<Object>} Message in JSON format with media info
 */
async function messageToJson(
    client,
    message,
    sectionDir,
    downloadConfig,
    stats,
    sectionStats = null,
    scraper = null,
    logFn = console.log,
) {
    const json = {
        id: message.id,
        date: message.date ? (
            message.date instanceof Date ?
                message.date.toISOString() :
                new Date(message.date).toISOString()
        ) : new Date().toISOString(),
        text: message.message || '',
        entities: message.entities || [],
        media: [],
        referencedMessages: [],
    };

    // Download media if present
    if (message.media) {
        json.media = await processMessageMedia(
            client,
            message,
            sectionDir,
            downloadConfig,
            stats,
            sectionStats,
            logFn,
        );
    }

    // Extract referenced messages from text
    if (message.message) {
        json.referencedMessages = TelegramParser.extractReferencedMessages(message.message);
    }

    // Convert to HTML for easier processing later
    if (message.message && message.entities) {
        let html = message.message;
        const entities = [...message.entities].sort((a, b) => a.offset - b.offset);

        for (let i = entities.length - 1; i >= 0; i--) {
            const entity = entities[i];
            const before = html.substring(0, entity.offset);
            let text = html.substring(entity.offset, entity.offset + entity.length);
            const after = html.substring(entity.offset + entity.length);

            let tag = '';
            switch (entity.className) {
            case 'MessageEntityBold':
                tag = 'strong';
                break;
            case 'MessageEntityItalic':
                tag = 'em';
                break;
            case 'MessageEntityCode':
                tag = 'code';
                break;
            case 'MessageEntityPre':
                tag = 'pre';
                break;
            case 'MessageEntityUrl':
            case 'MessageEntityTextUrl':
                tag = 'a';
                text = `<a href="${entity.url || text}">${text}</a>`;
                break;
            default:
                tag = '';
            }

            if (tag && !text.includes('<')) {
                html = before + `<${tag}>${text}</${tag}>` + after;
            }
        }

        json.rawHtml = html;
    } else {
        json.rawHtml = json.text;
    }

    // Extract external URLs for reference
    if (scraper) {
        json.externalUrls = scraper.extractExternalUrls(json.text);
    }

    return json;
}

/**
 * Download a specific message with caching
 * @param {Object} client - Telegram client instance
 * @param {Object} chat - Telegram chat entity
 * @param {number} messageId - Message ID to download
 * @param {string} sectionDir - Section directory path
 * @param {boolean} [isReferenced=false] - Whether this is a referenced message
 * @param {Object} downloadConfig - Download configuration
 * @param {Object} stats - Statistics tracker
 * @param {Object} [sectionStats] - Section statistics tracker
 * @param {Object} scraper - Web scraper instance
 * @param {Set} downloadedMessages - Set of already downloaded message IDs
 * @param {Function} logFn - Logging function
 * @param {Function} warnFn - Warning function
 * @param {Function} errorFn - Error function
 * @returns {Promise<Object|null>} Message JSON or null if failed
 */
async function downloadMessage(
    client,
    chat,
    messageId,
    sectionDir,
    isReferenced = false,
    downloadConfig,
    stats,
    sectionStats = null,
    scraper = null,
    downloadedMessages = new Set(),
    logFn = console.log,
    warnFn = console.warn,
    errorFn = console.error,
) {
    // Check if already downloaded in this session
    if (downloadedMessages.has(messageId)) {
        return null;
    }

    // Check if message file already exists
    const subDir = isReferenced ? OUTPUT_DIRS.referenced : '';
    const messageDir = subDir ? path.join(sectionDir, subDir) : sectionDir;
    const filePath = path.join(messageDir, `${messageId}.json`);

    try {
        await fs.access(filePath);
        // Message already exists, load it
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const messageData = JSON.parse(content);
            downloadedMessages.add(messageId);
            logFn(`  Using cached message ${messageId}${isReferenced ? ' (referenced)' : ''}`);
            stats.incrementMessages('skipped');
            if (sectionStats) {
                const fileStats = await fs.stat(filePath);
                sectionStats.addCachedMessage(fileStats.size);
            }
            return messageData;
        } catch (err) {
            logFn(`  Corrupted cache for message ${messageId}, re-downloading`);
        }
    } catch {
        // File doesn't exist, continue to download
    }

    try {
        const messages = await client.getMessages(chat, {
            ids: [messageId],
        });

        if (messages.length === 0) {
            warnFn(`Message ${messageId} not found`);
            return null;
        }

        const message = messages[0];
        if (!message) {
            logFn(`Message ${messageId} is null or undefined (deleted from Telegram)`);
            return null;
        }

        // Additional validation for message properties
        if (!message.id) {
            errorFn(`Message ${messageId} has invalid or missing ID`);
            return null;
        }

        let messageJson;
        try {
            messageJson = await messageToJson(
                client,
                message,
                sectionDir,
                downloadConfig,
                stats,
                sectionStats,
                scraper,
                logFn,
            );
        } catch (processErr) {
            errorFn(`Failed to process message ${messageId}: ${processErr.message}`);

            // Create a minimal message object as fallback with safe property access
            messageJson = {
                id: message.id || messageId,
                date: message.date ? (
                    message.date instanceof Date ?
                        message.date.toISOString() :
                        new Date(message.date).toISOString()
                ) : new Date().toISOString(),
                text: message.message || '',
                entities: message.entities || [],
                media: [],
                referencedMessages: [],
                processingError: processErr.message,
                rawHtml: message.message || '',
            };

            logFn(`Created fallback message object for ${messageId}`);
        }

        // Save message - ensure directory exists
        if (subDir) {
            await fs.mkdir(messageDir, { recursive: true });
        }

        await fs.writeFile(filePath, JSON.stringify(messageJson, null, 2));

        downloadedMessages.add(messageId);

        logFn(`Downloaded message ${messageId}${isReferenced ? ' (referenced)' : ''}`);
        stats.incrementMessages('downloaded');
        if (sectionStats) {
            const content = JSON.stringify(messageJson, null, 2);
            sectionStats.addNewMessage(Buffer.byteLength(content, 'utf8'));
        }
        if (isReferenced) {
            stats.incrementMessages('referenced');
        }
        return messageJson;
    } catch (err) {
        errorFn(`Failed to download message ${messageId}: ${err.message}`);

        // Provide more context for common errors
        if (err.message.includes('MESSAGE_ID_INVALID')) {
            errorFn(`  Message ID ${messageId} is invalid or does not exist`);
        } else if (err.message.includes('CHANNEL_PRIVATE')) {
            errorFn('  No access to channel - check if you\'re a member');
        } else if (err.message.includes('CHAT_ADMIN_REQUIRED')) {
            errorFn('  Admin privileges required to access this message');
        } else if (err.message.includes('timeout')) {
            errorFn('  Request timed out - network issue or message too large');
        }

        stats.incrementMessages('failed');
        if (sectionStats) {
            sectionStats.addMissedMessage();
        }
        stats.addError(err, 'message-download', { messageId, isReferenced });
        return null;
    }
}

/**
 * Download all referenced messages recursively
 * Follows message links and downloads the entire chain
 * @param {Object} client - Telegram client instance
 * @param {Object} chat - Telegram chat entity
 * @param {number[]} messageIds - Array of message IDs to download
 * @param {string} sectionDir - Section directory path
 * @param {Object} downloadConfig - Download configuration
 * @param {Object} stats - Statistics tracker
 * @param {Object} [sectionStats] - Section statistics tracker
 * @param {Object} scraper - Web scraper instance
 * @param {Set} downloadedMessages - Set of already downloaded message IDs
 * @param {Function} logFn - Logging function
 * @param {Function} warnFn - Warning function
 * @param {Function} errorFn - Error function
 * @returns {Promise<Object[]>} Array of downloaded message objects
 */
async function downloadReferencedMessages(
    client,
    chat,
    messageIds,
    sectionDir,
    downloadConfig,
    stats,
    sectionStats = null,
    scraper = null,
    downloadedMessages = new Set(),
    logFn = console.log,
    warnFn = console.warn,
    errorFn = console.error,
) {
    const toDownload = [...messageIds];
    const downloaded = [];

    while (toDownload.length > 0) {
        const messageId = toDownload.shift();

        const message = await downloadMessage(
            client,
            chat,
            messageId,
            sectionDir,
            true, // isReferenced
            downloadConfig,
            stats,
            sectionStats,
            scraper,
            downloadedMessages,
            logFn,
            warnFn,
            errorFn,
        );

        if (message) {
            downloaded.push(message);

            // Add new referenced messages to queue
            for (const refId of message.referencedMessages) {
                if (!downloadedMessages.has(refId) && !toDownload.includes(refId)) {
                    toDownload.push(refId);
                }
            }
        }
    }

    return downloaded;
}

module.exports = {
    messageToJson,
    downloadMessage,
    downloadReferencedMessages,
};

