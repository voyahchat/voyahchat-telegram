/**
 * External links handling for Telegram messages
 *
 * This module provides functions for scraping and managing external links
 * found in Telegram messages, including statistics tracking and formatting.
 *
 * @module telegram/download-links
 */

const fs = require('fs').promises;
const path = require('path');
const { SCRAPER_DIRS, BYTES_PER_MB } = require('./constants');

/**
 * Get external links statistics for a channel/section
 * @param {string} baseDir - Base directory path
 * @returns {Promise<Object>} Statistics object with counts and sizes
 */
async function getExternalLinksStats(baseDir) {
    const linksDir = path.join(baseDir, SCRAPER_DIRS.links);
    const stats = {
        totalLinks: 0,
        downloadedLinks: 0,
        skippedLinks: 0,
        totalSize: 0,
        messagesWithLinks: 0,
    };

    try {
        const messageDirs = await fs.readdir(linksDir);

        for (const messageDir of messageDirs) {
            const messagePath = path.join(linksDir, messageDir);
            const stat = await fs.stat(messagePath);

            if (stat.isDirectory()) {
                let messageHasLinks = false;
                try {
                    const files = await fs.readdir(messagePath);
                    for (const file of files) {
                        if (file !== 'scraper-cache.json') {
                            const filePath = path.join(messagePath, file);
                            const fileStat = await fs.stat(filePath);
                            if (fileStat.isFile()) {
                                stats.totalLinks++;
                                stats.totalSize += fileStat.size;
                                messageHasLinks = true;
                            }
                        }
                    }
                    if (messageHasLinks) {
                        stats.messagesWithLinks++;
                    }
                } catch {
                    // Directory access error, skip
                }
            }
        }

        // Count downloaded vs skipped from cache
        const cachePath = path.join(linksDir, 'scraper-cache.json');
        try {
            const cacheContent = await fs.readFile(cachePath, 'utf8');
            const cache = JSON.parse(cacheContent);
            stats.downloadedLinks = Object.keys(cache).length;
            stats.skippedLinks = Math.max(0, stats.totalLinks - stats.downloadedLinks);
        } catch {
            // No cache file, assume all were downloaded
            stats.downloadedLinks = stats.totalLinks;
        }
    } catch {
        // Links directory doesn't exist
    }

    return stats;
}

/**
 * Scrape external links from a message
 * @param {Object} options - Scrape options
 * @param {Object} options.scraper - Web scraper instance
 * @param {Object} options.messageJson - Parsed message JSON
 * @param {string} options.baseDir - Base directory path
 * @param {number} options.messageId - Message ID for organizing output
 * @param {Function} options.log - Logging function
 * @returns {Promise<void>}
 */
async function scrapeExternalLinks(options) {
    const { scraper, messageJson, baseDir, messageId, log } = options;

    const externalUrls = scraper.extractExternalUrls(messageJson.text);
    if (externalUrls.length === 0) {
        return;
    }

    log(`  Found ${externalUrls.length} external link(s) in message ${messageId}`);

    const linksDir = path.join(baseDir, SCRAPER_DIRS.links, String(messageId));

    for (const url of externalUrls) {
        try {
            const result = await scraper.downloadPage(url, linksDir);
            if (result.skipped) {
                log(`  Skipped ${url}: ${result.reason}`);
            } else if (result.success) {
                log(`  Downloaded ${url}`);
            } else {
                log(`  Failed to download ${url}: ${result.error}`);
            }
        } catch (err) {
            log(`  Error scraping ${url}: ${err.message}`);
        }
    }
}

/**
 * Format links statistics for display
 * @param {Object} linksStats - Links statistics object
 * @returns {string[]} Array of formatted strings
 */
function formatLinksInfo(linksStats) {
    const linksInfo = [];
    if (linksStats.totalLinks > 0) {
        linksInfo.push(`${linksStats.totalLinks} links`);
        if (linksStats.downloadedLinks > 0) {
            const sizeMb = (linksStats.totalSize / BYTES_PER_MB).toFixed(1);
            linksInfo.push(`${sizeMb}Mb`);
        }
    }
    return linksInfo;
}

module.exports = {
    getExternalLinksStats,
    scrapeExternalLinks,
    formatLinksInfo,
};

