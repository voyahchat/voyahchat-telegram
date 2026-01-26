/**
 * Download module index
 * Exports all functions from the download modules (utils, media, message, links)
 *
 * @module telegram/download-index
 */

// Import all functions from download modules
const {
    getDirectorySize,
    calculateSectionSize,
    ensureDir,
} = require('./download-utils');

const {
    downloadMedia,
    processMessageMedia,
    getMediaExtension,
    getEstimatedFileSize,
    createMediaFileInfo,
} = require('./download-media');

const {
    messageToJson,
    downloadMessage,
    downloadReferencedMessages,
} = require('./download-message');

const {
    getExternalLinksStats,
    scrapeExternalLinks,
    formatLinksInfo,
} = require('./download-links');

// Export all functions from utils module
module.exports.getDirectorySize = getDirectorySize;
module.exports.calculateSectionSize = calculateSectionSize;
module.exports.ensureDir = ensureDir;

// Export all functions from media module
module.exports.downloadMedia = downloadMedia;
module.exports.processMessageMedia = processMessageMedia;
module.exports.getMediaExtension = getMediaExtension;
module.exports.getEstimatedFileSize = getEstimatedFileSize;
module.exports.createMediaFileInfo = createMediaFileInfo;

// Export all functions from message module
module.exports.messageToJson = messageToJson;
module.exports.downloadMessage = downloadMessage;
module.exports.downloadReferencedMessages = downloadReferencedMessages;

// Export all functions from links module
module.exports.getExternalLinksStats = getExternalLinksStats;
module.exports.scrapeExternalLinks = scrapeExternalLinks;
module.exports.formatLinksInfo = formatLinksInfo;

