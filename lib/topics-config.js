/**
 * Configuration loader for topics
 * Handles loading and saving of topics configuration
 *
 * @module telegram/topics-config
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Configuration loader for topics
 */
class TopicsConfig {
    constructor(baseDir = null) {
        this.config = null;
        this.baseDir = baseDir || process.cwd();
        this.configPath = path.join(this.baseDir, 'config', 'topics.yml');
    }

    /**
     * Load topics configuration from config/topics.yml
     * @returns {Promise<Object>} Topics configuration object
     * @throws {Error} If config file is missing or invalid
     */
    async load() {
        if (this.config) {
            return this.config;
        }

        try {
            const configFile = await fs.readFile(this.configPath, 'utf8');
            this.config = yaml.load(configFile);
            return this.config;
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw new Error(
                    'Topics config not found. Please create config/topics.yml ' +
                    'with topics configuration.',
                );
            }
            throw new Error(`Failed to load topics config: ${err.message}`);
        }
    }

    /**
     * Save configuration to file
     * @param {Object} config - Configuration object to save
     * @returns {Promise<void>}
     * @throws {Error} If config file cannot be written
     */
    async save(config) {
        try {
            const yamlString = yaml.dump(config, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });
            await fs.writeFile(this.configPath, yamlString, 'utf8');
            this.config = config; // Update cache
        } catch (err) {
            throw new Error(`Failed to save topics config: ${err.message}`);
        }
    }

    /**
     * Returns all topics
     * @returns {Promise<Array>} Array of topic objects
     * @throws {Error} If config cannot be loaded
     */
    async getTopics() {
        const config = await this.load();
        return config.topics || [];
    }

    /**
     * Returns topics with both pinned file path and pinnedId
     * @returns {Promise<Array>} Array of topic objects with pinned info
     * @throws {Error} If config cannot be loaded
     */
    async getTopicsWithPinned() {
        const topics = await this.getTopics();
        return topics.filter(topic => topic.pinned && topic.pinnedId);
    }

    /**
     * Returns topics that have pinnedId (message ID in Telegram)
     * Used for downloading pinned messages from Telegram
     * @returns {Promise<Array>} Array of topic objects with pinnedId
     * @throws {Error} If config cannot be loaded
     */
    async getTopicsWithPinnedId() {
        const topics = await this.getTopics();
        return topics.filter(topic => topic.pinnedId);
    }

    /**
     * Returns a specific topic by slug
     * @param {string} slug - Topic slug to find
     * @returns {Promise<Object|undefined>} Topic object or undefined if not found
     * @throws {Error} If config cannot be loaded
     */
    async getTopic(slug) {
        const topics = await this.getTopics();
        return topics.find(topic => topic.slug === slug);
    }

    /**
     * Updates the pinned message ID for a topic
     * @param {string} slug - Topic slug to update
     * @param {number} newPinnedId - New pinned message ID
     * @returns {Promise<Object>} Updated topic object
     * @throws {Error} If topic not found or config cannot be saved
     */
    async updatePinnedId(slug, newPinnedId) {
        const config = await this.load();
        const topic = config.topics.find(t => t.slug === slug);

        if (!topic) {
            throw new Error(`Topic with slug "${slug}" not found`);
        }

        topic.pinnedId = newPinnedId;
        await this.save(config);
        return topic;
    }

    /**
     * Updates the pinned file path for a topic
     * @param {string} slug - Topic slug to update
     * @param {string} pinnedPath - Path to the pinned markdown file
     * @returns {Promise<Object>} Updated topic object
     * @throws {Error} If topic not found or config cannot be saved
     */
    async updatePinnedPath(slug, pinnedPath) {
        const config = await this.load();
        const topic = config.topics.find(t => t.slug === slug);

        if (!topic) {
            throw new Error(`Topic with slug "${slug}" not found`);
        }

        topic.pinned = pinnedPath;
        await this.save(config);
        return topic;
    }

    /**
     * Updates the bot pinned message ID for a topic
     * @param {string} slug - Topic slug to update
     * @param {number} botPinnedId - Bot pinned message ID
     * @returns {Promise<boolean>} True if successful, false if topic not found
     * @throws {Error} If config cannot be saved
     */
    async updateBotPinnedId(slug, botPinnedId) {
        const config = await this.load();
        const topic = config.topics.find(t => t.slug === slug);

        if (!topic) {
            return false;
        }

        topic.botPinnedId = botPinnedId;
        await this.save(config);
        return true;
    }

    /**
     * Returns topics that have a pinned field (for bot sync)
     * @returns {Promise<Array>} Array of topic objects with pinned field
     * @throws {Error} If config cannot be loaded
     */
    async getTopicsForBotSync() {
        const topics = await this.getTopics();
        return topics
            .filter(topic => topic.pinned)
            .filter(topic => {
                if (!topic.topicId) {
                    console.error(`Topic "${topic.slug}" skipped: missing topicId`);
                    return false;
                }
                return true;
            })
            .map(topic => ({
                title: topic.title,
                slug: topic.slug,
                topicId: topic.topicId,
                pinnedId: topic.pinnedId,
                botPinnedId: topic.botPinnedId,
                pinned: topic.pinned,
                contentHash: topic.contentHash || null,
            }));
    }

    /**
     * Updates the content hash for a topic (used to detect unchanged messages)
     * @param {string} slug - Topic slug to update
     * @param {string} hash - SHA-256 hex hash of content
     * @returns {Promise<boolean>} True if successful, false if topic not found
     * @throws {Error} If config cannot be saved
     */
    async updateContentHash(slug, hash) {
        const config = await this.load();
        const topic = config.topics.find(t => t.slug === slug);

        if (!topic) {
            return false;
        }

        topic.contentHash = hash;
        await this.save(config);
        return true;
    }

    /**
     * Reads markdown file content
     * @param {string} pinnedPath - Path to the markdown file
     * @returns {Promise<string>} Content of the markdown file
     * @throws {Error} If file cannot be read
     */
    async readPinnedFile(pinnedPath) {
        try {
            const filePath = path.resolve(this.baseDir, pinnedPath);
            return await fs.readFile(filePath, 'utf8');
        } catch (err) {
            throw new Error(`Failed to read pinned file "${pinnedPath}": ${err.message}`);
        }
    }

    /**
     * Writes markdown content to a pinned file
     * @param {string} pinnedPath - Path to the markdown file (relative to baseDir)
     * @param {string} content - Markdown content to write
     * @returns {Promise<void>}
     * @throws {Error} If file cannot be written
     */
    async writePinnedFile(pinnedPath, content) {
        try {
            const filePath = path.resolve(this.baseDir, pinnedPath);
            const dir = path.dirname(filePath);

            // Ensure directory exists
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(filePath, content, 'utf8');
        } catch (err) {
            throw new Error(`Failed to write pinned file "${pinnedPath}": ${err.message}`);
        }
    }

    /**
     * Writes image data to a file
     * @param {string} imagePath - Path to the image file (relative to baseDir)
     * @param {Buffer} imageData - Image data buffer
     * @returns {Promise<void>}
     * @throws {Error} If file cannot be written
     */
    async writeImageFile(imagePath, imageData) {
        try {
            const filePath = path.resolve(this.baseDir, imagePath);
            const dir = path.dirname(filePath);

            // Ensure directory exists
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(filePath, imageData);
        } catch (err) {
            throw new Error(`Failed to write image file "${imagePath}": ${err.message}`);
        }
    }

    /**
     * Checks for associated image files
     * @param {string} pinnedPath - Path to the markdown file
     * @returns {Promise<string|null>} Path to image file if found, null otherwise
     */
    async getImagePath(pinnedPath) {
        try {
            const dir = path.dirname(pinnedPath);
            const name = path.basename(pinnedPath, path.extname(pinnedPath));
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

            for (const ext of imageExtensions) {
                const imagePath = path.join(dir, `${name}${ext}`);
                const fullPath = path.resolve(this.baseDir, imagePath);

                try {
                    await fs.access(fullPath);
                    return imagePath;
                } catch {
                    // File doesn't exist, continue checking other extensions
                }
            }

            return null;
        } catch (err) {
            throw new Error(`Failed to check for image for "${pinnedPath}": ${err.message}`);
        }
    }

    /**
     * Get git modification date of a file
     * @param {string} filePath - Path to the file (relative to baseDir)
     * @returns {Promise<Date|null>} Modification date from git or null if not in git
     * @private
     */
    async _getGitModDate(filePath) {
        try {
            const fullPath = path.resolve(this.baseDir, filePath);
            const { stdout } = await execAsync(
                `git log -1 --format=%ct -- "${fullPath}"`,
                { cwd: this.baseDir },
            );
            if (stdout.trim()) {
                return new Date(parseInt(stdout.trim(), 10) * 1000);
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get modification date of markdown file from git history
     * @param {string} pinnedPath - Path to the markdown file
     * @returns {Promise<Date|null>} Modification date from git or null
     */
    async getFileModDate(pinnedPath) {
        return this._getGitModDate(pinnedPath);
    }

    /**
     * Get modification date of associated image from git history
     * @param {string} pinnedPath - Path to the markdown file
     * @returns {Promise<Date|null>} Modification date or null if no image
     */
    async getImageModDate(pinnedPath) {
        const imagePath = await this.getImagePath(pinnedPath);
        if (!imagePath) {
            return null;
        }
        return this._getGitModDate(imagePath);
    }

    /**
     * Get latest modification date from git (md file or image)
     * @param {string} pinnedPath - Path to the markdown file
     * @returns {Promise<Date>} Latest modification date
     * @throws {Error} If neither file has git history
     */
    async getLatestModDate(pinnedPath) {
        const fileDate = await this.getFileModDate(pinnedPath);
        const imageDate = await this.getImageModDate(pinnedPath);

        if (!fileDate && !imageDate) {
            // Fallback to FS mtime if not in git yet
            const filePath = path.resolve(this.baseDir, pinnedPath);
            const stats = await fs.stat(filePath);
            return stats.mtime;
        }

        if (imageDate && fileDate && imageDate > fileDate) {
            return imageDate;
        }
        return fileDate || imageDate;
    }
}

/**
 * Format date as DD.MM.YYYY
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

/**
 * Generate title line for Telegram message
 * @param {string} title - Topic title from topics.yml
 * @param {Date} modDate - Modification date
 * @returns {string} Formatted title line
 */
function generateTitleLine(title, modDate) {
    const dateStr = formatDate(modDate);
    return `**${title}**, обновлено ${dateStr}`;
}

module.exports = { TopicsConfig, formatDate, generateTitleLine };
