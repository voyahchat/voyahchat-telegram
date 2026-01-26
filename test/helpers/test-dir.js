const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

/**
 * TestDir - Test directory helper for isolated test execution
 *
 * Creates unique test directories in `.test/` for each test instance.
 * This ensures parallel test execution doesn't cause conflicts.
 *
 * Usage:
 *   const dir = new TestDir();
 *   const configDir = dir.getConfig(); // Creates and returns config directory
 *   const dataDir = dir.getData();     // Creates and returns data directory
 *
 * Directory structure created:
 *   .test/
 *     test-<random>/
 *       config/
 *       data/
 *         pinned/
 *       downloaded/
 *       cache/
 *
 * @class TestDir
 */
class TestDir {
    /**
     * Create unique test directory
     *
     * Creates a new directory with random name in `.test/` folder.
     * The directory is created immediately upon instantiation.
     *
     * @constructor
     */
    constructor() {
        const testBuildDir = path.join(__dirname, '..', '..', '.test');
        const randomDirName = 'test-' + crypto.randomBytes(8).toString('hex');
        this.root = path.join(testBuildDir, randomDirName);
        fs.mkdirSync(this.root, { recursive: true });

        // Track created directories to avoid redundant mkdir calls
        this._created = new Set([this.root]);
    }

    /**
     * Ensure directory exists, creating if needed
     *
     * @private
     * @param {string} dirPath - Directory path to ensure exists
     * @returns {string} The directory path
     */
    _ensureDir(dirPath) {
        if (!this._created.has(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            this._created.add(dirPath);
        }
        return dirPath;
    }

    /**
     * Get root test directory path
     *
     * @returns {string} Path to test root directory
     */
    getRoot() {
        return this.root;
    }

    /**
     * Get config directory path
     *
     * Creates the directory if it doesn't exist.
     * Used for storing test configuration files (main.yml, auth.yml, etc.)
     *
     * @returns {string} Path to config directory
     */
    getConfig() {
        return this._ensureDir(path.join(this.root, 'config'));
    }

    /**
     * Get data directory path
     *
     * Creates the directory if it doesn't exist.
     * Used for storing test data files.
     *
     * @returns {string} Path to data directory
     */
    getData() {
        return this._ensureDir(path.join(this.root, 'data'));
    }

    /**
     * Get data/pinned directory path
     *
     * Creates the directory if it doesn't exist.
     * Used for storing pinned message markdown files.
     *
     * @returns {string} Path to data/pinned directory
     */
    getPinned() {
        return this._ensureDir(path.join(this.root, 'data', 'pinned'));
    }

    /**
     * Get downloaded directory path
     *
     * Creates the directory if it doesn't exist.
     * Used for storing downloaded Telegram messages and media.
     *
     * @returns {string} Path to downloaded directory
     */
    getDownloaded() {
        return this._ensureDir(path.join(this.root, 'downloaded'));
    }

    /**
     * Get cache directory path
     *
     * Creates the directory if it doesn't exist.
     * Used for storing scraper cache and other cached data.
     *
     * @returns {string} Path to cache directory
     */
    getCache() {
        return this._ensureDir(path.join(this.root, 'cache'));
    }
}

module.exports = { TestDir };
