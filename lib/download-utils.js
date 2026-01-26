/**
 * Utility functions for downloading Telegram content
 *
 * This module provides utility functions for directory operations,
 * size calculations, and file system operations used by the download modules.
 *
 * @module telegram/download-utils
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Get total size of a directory recursively using Node.js fs API
 * @param {string} dirPath - Directory path
 * @param {Function} [logFn] - Optional logging function
 * @returns {Promise<number>} Total size in bytes
 */
async function getDirectorySize(dirPath, logFn = null) {
    let totalSize = 0;

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                totalSize += await getDirectorySize(fullPath, logFn);
            } else if (entry.isFile()) {
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
            }
        }
    } catch (err) {
        if (logFn) {
            logFn(`Error calculating directory size for ${dirPath}: ${err.message}`);
        }
    }

    return totalSize;
}

/**
 * Calculate total size of a section directory recursively
 * @param {string} sectionDir - Section directory path
 * @param {Object} sectionStats - Section statistics object with addCachedBytes method
 * @param {Function} [logFn] - Optional logging function
 * @returns {Promise<void>}
 */
async function calculateSectionSize(sectionDir, sectionStats, logFn = null) {
    try {
        await fs.access(sectionDir);
        const totalSize = await getDirectorySize(sectionDir, logFn);
        if (totalSize > 0) {
            sectionStats.addCachedBytes(totalSize);
        }
    } catch {
        // Directory doesn't exist or can't access
    }
}

/**
 * Ensure directory exists, creating if needed
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
async function ensureDir(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

module.exports = {
    getDirectorySize,
    calculateSectionSize,
    ensureDir,
};

