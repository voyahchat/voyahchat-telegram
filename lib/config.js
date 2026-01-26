/**
 * Configuration loader for Telegram downloader
 * Handles loading and saving of telegram and auth configurations
 *
 * @module telegram/config
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { DEFAULT_DOWNLOAD_CONFIG } = require('./constants');

/**
 * Configuration loader for Telegram downloader
 */
class TelegramConfig {
    constructor(baseDir = null) {
        this._validateBaseDir(baseDir);
        this.telegramConfig = null;
        this.authConfig = null;
        this.baseDir = baseDir || process.cwd();
    }

    /**
     * Validates the base directory parameter
     * @param {string} baseDir - Base directory path
     * @throws {Error} If baseDir is invalid
     * @private
     */
    _validateBaseDir(baseDir) {
        if (baseDir !== null && (typeof baseDir !== 'string' || baseDir.trim() === '')) {
            throw new Error('baseDir must be a non-empty string or null');
        }
    }

    /**
     * Validates API credentials configuration
     * @param {Object} config - Configuration object
     * @throws {Error} If API credentials are invalid
     * @private
     */
    _validateApiCredentials(config) {
        if (!config.api_id) {
            throw new Error('Missing required field "api_id" in config/main.yml');
        }

        if (typeof config.api_id !== 'number' || config.api_id <= 0 || !Number.isInteger(config.api_id)) {
            throw new Error('api_id must be a positive integer in config/main.yml');
        }

        if (!config.api_hash) {
            throw new Error('Missing required field "api_hash" in config/main.yml');
        }

        if (typeof config.api_hash !== 'string' || config.api_hash.trim() === '') {
            throw new Error('api_hash must be a non-empty string in config/main.yml');
        }
    }

    /**
     * Validates chat configuration
     * @param {Object} config - Configuration object
     * @throws {Error} If chat configuration is invalid
     * @private
     */
    _validateChatConfig(config) {
        if (!config.chat) {
            throw new Error('Missing required field "chat" in config/download.yml');
        }

        if (typeof config.chat !== 'object' || Array.isArray(config.chat)) {
            throw new Error('chat must be an object in config/download.yml');
        }

        // Support both old and new format
        const chatName = config.chat.name || config.chat;
        if (!chatName) {
            throw new Error('Missing required field "chat.name" in config/download.yml');
        }

        if (typeof chatName !== 'string' || chatName.trim() === '') {
            throw new Error('chat.name must be a non-empty string in config/download.yml');
        }
    }

    /**
     * Load topics configuration
     * @returns {Promise<Array>} Array of topic configuration objects
     * @throws {Error} If topics config file is missing or invalid
     * @private
     */
    async _loadTopicsConfig() {
        const topicsPath = path.join(this.baseDir, 'config', 'topics.yml');
        try {
            const topicsFile = await fs.readFile(topicsPath, 'utf8');
            const topicsConfig = yaml.load(topicsFile);
            return topicsConfig?.topics || [];
        } catch (err) {
            if (err.code === 'ENOENT') {
                return []; // topics.yml is optional
            }
            throw new Error(`Failed to load topics config: ${err.message}`);
        }
    }

    /**
     * Resolve section by looking up topic info from topics.yml
     * @param {Object} section - Section object with at least slug
     * @param {Array} topics - Array of topics from topics.yml
     * @returns {Object} Section with full topic info
     * @private
     */
    _resolveSectionFromTopics(section, topics) {
        if (section.name && section.topicId) {
            return section; // Already has full info
        }

        const topic = topics.find(t => t.slug === section.slug);
        if (!topic) {
            return section; // Topic not found, return as-is
        }

        return {
            name: topic.title,
            slug: section.slug,
            topicId: topic.topicId,
            pinnedMessageId: topic.pinnedMessageId,
            ...section, // Allow section to override topic values
        };
    }

    /**
     * Validates sections configuration
     * @param {Object} config - Configuration object
     * @param {Array} topics - Array of topics from topics.yml
     * @throws {Error} If sections configuration is invalid
     * @private
     */
    _validateSectionsConfig(config, topics = []) {
        // Support both old and new format
        const sections = config.chat?.sections || config.sections;

        if (!sections) {
            throw new Error('Missing required field "sections" in config/download.yml');
        }

        if (!Array.isArray(sections)) {
            throw new Error('sections must be an array in config/download.yml');
        }

        // Note: We allow empty sections arrays for flexibility in certain test scenarios
        // but validate that if sections exist, they are properly configured

        sections.forEach((section, index) => {
            if (!section || typeof section !== 'object') {
                throw new Error(`Section at index ${index} must be an object in config/download.yml`);
            }

            if (!section.slug) {
                throw new Error(`Section at index ${index} missing required field "slug" in config/download.yml`);
            }

            if (typeof section.slug !== 'string' || section.slug.trim() === '') {
                throw new Error(`Section slug at index ${index} must be a non-empty string in config/download.yml`);
            }

            // Validate slug format (alphanumeric with hyphens and underscores)
            if (!/^[a-zA-Z0-9_-]+$/.test(section.slug)) {
                throw new Error(
                    `Section slug "${section.slug}" at index ${index} contains invalid ` +
                    'characters. Only alphanumeric characters, hyphens, and ' +
                    'underscores are allowed in config/download.yml',
                );
            }

            // Check for duplicate slugs
            const duplicateCount = sections.filter(s => s.slug === section.slug).length;
            if (duplicateCount > 1) {
                throw new Error(`Duplicate section slug "${section.slug}" found in config/download.yml`);
            }

            // Resolve section from topics if only slug is provided
            const resolvedSection = this._resolveSectionFromTopics(section, topics);

            // Validate name - required either in section or resolved from topics
            if (!resolvedSection.name) {
                throw new Error(
                    `Section at index ${index} with slug "${section.slug}" missing required field "name". ` +
                    'Either add "name" to the section or ensure the topic exists in config/topics.yml',
                );
            }

            if (typeof resolvedSection.name !== 'string' || resolvedSection.name.trim() === '') {
                throw new Error(`Section name at index ${index} must be a non-empty string in config/download.yml`);
            }

            // Validate optional fields
            if (resolvedSection.topicId !== undefined) {
                if (typeof resolvedSection.topicId !== 'number' ||
                    resolvedSection.topicId <= 0 ||
                    !Number.isInteger(resolvedSection.topicId)) {
                    throw new Error(
                        `Section topicId at index ${index} must be a positive ` +
                        'integer in config/download.yml',
                    );
                }
            }

            if (resolvedSection.pinnedMessageId !== undefined) {
                if (typeof resolvedSection.pinnedMessageId !== 'number' ||
                    resolvedSection.pinnedMessageId <= 0 ||
                    !Number.isInteger(resolvedSection.pinnedMessageId)) {
                    throw new Error(
                        `Section pinnedMessageId at index ${index} must be a ` +
                        'positive integer in config/download.yml',
                    );
                }
            }
        });
    }

    /**
     * Validates additional messages configuration
     * @param {Object} config - Configuration object
     * @throws {Error} If additional messages configuration is invalid
     * @private
     */
    _validateAdditionalMessages(config) {
        if (config.additionalMessages !== undefined) {
            if (!Array.isArray(config.additionalMessages)) {
                throw new Error('additionalMessages must be an array in config/download.yml');
            }

            config.additionalMessages.forEach((message, index) => {
                if (!message || typeof message !== 'object') {
                    throw new Error(`Additional message at index ${index} must be an object in config/download.yml`);
                }

                if (!message.name) {
                    throw new Error(
                        `Additional message at index ${index} missing required ` +
                        'field "name" in config/download.yml',
                    );
                }

                if (typeof message.name !== 'string' || message.name.trim() === '') {
                    throw new Error(
                        `Additional message name at index ${index} must be a ` +
                        'non-empty string in config/download.yml',
                    );
                }

                if (!message.slug) {
                    throw new Error(
                        `Additional message at index ${index} missing required ` +
                        'field "slug" in config/download.yml',
                    );
                }

                if (typeof message.slug !== 'string' || message.slug.trim() === '') {
                    throw new Error(
                        `Additional message slug at index ${index} must be a ` +
                        'non-empty string in config/download.yml',
                    );
                }

                // Validate slug format
                if (!/^[a-zA-Z0-9_-]+$/.test(message.slug)) {
                    throw new Error(
                        `Additional message slug "${message.slug}" at index ${index} ` +
                        'contains invalid characters. Only alphanumeric characters, ' +
                        'hyphens, and underscores are allowed in config/download.yml',
                    );
                }

                if (!message.messageId) {
                    throw new Error(
                        `Additional message at index ${index} missing required ` +
                        'field "messageId" in config/download.yml',
                    );
                }

                if (typeof message.messageId !== 'number' ||
                    message.messageId <= 0 ||
                    !Number.isInteger(message.messageId)) {
                    throw new Error(
                        `Additional message messageId at index ${index} must be a ` +
                        'positive integer in config/download.yml',
                    );
                }
            });
        }
    }

    /**
     * Validates download configuration
     * @param {Object} config - Configuration object
     * @throws {Error} If download configuration is invalid
     * @private
     */
    _validateDownloadConfig(config) {
        if (config.download !== undefined) {
            if (typeof config.download !== 'object' || Array.isArray(config.download)) {
                throw new Error('download must be an object in config/download.yml');
            }

            // Validate maxRetries
            if (config.download.maxRetries !== undefined) {
                if (typeof config.download.maxRetries !== 'number' ||
                    config.download.maxRetries < 0 ||
                    !Number.isInteger(config.download.maxRetries)) {
                    throw new Error(
                        'download.maxRetries must be a non-negative integer ' +
                        'in config/download.yml',
                    );
                }
                if (config.download.maxRetries > 100) {
                    throw new Error(
                        'download.maxRetries must not exceed 100 ' +
                        'in config/download.yml',
                    );
                }
            }

            // Validate retryDelayBaseMs
            if (config.download.retryDelayBaseMs !== undefined) {
                if (typeof config.download.retryDelayBaseMs !== 'number' ||
                    config.download.retryDelayBaseMs < 0 ||
                    !Number.isInteger(config.download.retryDelayBaseMs)) {
                    throw new Error(
                        'download.retryDelayBaseMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate retryDelayMaxMs
            if (config.download.retryDelayMaxMs !== undefined) {
                if (typeof config.download.retryDelayMaxMs !== 'number' ||
                    config.download.retryDelayMaxMs < 0 ||
                    !Number.isInteger(config.download.retryDelayMaxMs)) {
                    throw new Error(
                        'download.retryDelayMaxMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate retryJitterMs
            if (config.download.retryJitterMs !== undefined) {
                if (typeof config.download.retryJitterMs !== 'number' ||
                    config.download.retryJitterMs < 0 ||
                    !Number.isInteger(config.download.retryJitterMs)) {
                    throw new Error(
                        'download.retryJitterMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate timeoutBaseMs
            if (config.download.timeoutBaseMs !== undefined) {
                if (typeof config.download.timeoutBaseMs !== 'number' ||
                    config.download.timeoutBaseMs < 0 ||
                    !Number.isInteger(config.download.timeoutBaseMs)) {
                    throw new Error(
                        'download.timeoutBaseMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate timeoutPerMbMs
            if (config.download.timeoutPerMbMs !== undefined) {
                if (typeof config.download.timeoutPerMbMs !== 'number' ||
                    config.download.timeoutPerMbMs < 0 ||
                    !Number.isInteger(config.download.timeoutPerMbMs)) {
                    throw new Error(
                        'download.timeoutPerMbMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate timeoutMaxMs
            if (config.download.timeoutMaxMs !== undefined) {
                if (typeof config.download.timeoutMaxMs !== 'number' ||
                    config.download.timeoutMaxMs < 0 ||
                    !Number.isInteger(config.download.timeoutMaxMs)) {
                    throw new Error(
                        'download.timeoutMaxMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate connectionRetries
            if (config.download.connectionRetries !== undefined) {
                if (typeof config.download.connectionRetries !== 'number' ||
                    config.download.connectionRetries < 0 ||
                    !Number.isInteger(config.download.connectionRetries)) {
                    throw new Error(
                        'download.connectionRetries must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
                if (config.download.connectionRetries > 100) {
                    throw new Error(
                        'download.connectionRetries must not exceed 100 ' +
                        'in config/download.yml',
                    );
                }
            }

            // Validate connectionTimeoutMs
            if (config.download.connectionTimeoutMs !== undefined) {
                if (typeof config.download.connectionTimeoutMs !== 'number' ||
                    config.download.connectionTimeoutMs < 0 ||
                    !Number.isInteger(config.download.connectionTimeoutMs)) {
                    throw new Error(
                        'download.connectionTimeoutMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }

            // Validate messagesPerRequest
            if (config.download.messagesPerRequest !== undefined) {
                if (typeof config.download.messagesPerRequest !== 'number' ||
                    config.download.messagesPerRequest < 1 ||
                    !Number.isInteger(config.download.messagesPerRequest)) {
                    throw new Error(
                        'download.messagesPerRequest must be a positive ' +
                        'integer in config/download.yml',
                    );
                }
                if (config.download.messagesPerRequest > 1000) {
                    throw new Error(
                        'download.messagesPerRequest must not exceed 1000 ' +
                        'in config/download.yml',
                    );
                }
            }

            // Validate rateLimitDelayMs
            if (config.download.rateLimitDelayMs !== undefined) {
                if (typeof config.download.rateLimitDelayMs !== 'number' ||
                    config.download.rateLimitDelayMs < 0 ||
                    !Number.isInteger(config.download.rateLimitDelayMs)) {
                    throw new Error(
                        'download.rateLimitDelayMs must be a non-negative ' +
                        'integer in config/download.yml',
                    );
                }
            }
        }
    }

    /**
     * Validates authentication configuration
     * @param {Object} config - Authentication configuration object
     * @throws {Error} If authentication configuration is invalid
     * @private
     */
    _validateAuthConfig(config) {
        if (!config.phone) {
            throw new Error('Missing required field "phone" in config/auth.yml');
        }

        if (typeof config.phone !== 'string' || config.phone.trim() === '') {
            throw new Error('phone must be a non-empty string in config/auth.yml');
        }

        // Validate phone number format (basic validation)
        if (!/^\+?[0-9]{10,15}$/.test(config.phone.replace(/\s/g, ''))) {
            throw new Error(
                'phone must be a valid phone number in config/auth.yml ' +
                '(10-15 digits, optionally starting with +)',
            );
        }
    }

    /**
     * Load telegram configuration
     * @returns {Promise<Object>} Telegram configuration object
     * @throws {Error} If config file is missing or invalid
     */
    async loadTelegramConfig() {
        if (this.telegramConfig) {
            return this.telegramConfig;
        }

        try {
            // First try to load main.yml for API credentials
            const mainConfigPath = path.join(this.baseDir, 'config', 'main.yml');
            let mainConfig = {};
            const mainConfigFile = await fs.readFile(mainConfigPath, 'utf8');
            mainConfig = yaml.load(mainConfigFile);

            // Then try to load download.yml for chat and sections configuration
            const downloadConfigPath = path.join(this.baseDir, 'config', 'download.yml');
            let downloadConfig = {};
            const downloadConfigFile = await fs.readFile(downloadConfigPath, 'utf8');
            downloadConfig = yaml.load(downloadConfigFile);

            // Merge configurations
            this.telegramConfig = { ...mainConfig, ...downloadConfig };

            // Load topics for section resolution
            const topics = await this._loadTopicsConfig();

            // Validate all configuration components
            this._validateApiCredentials(this.telegramConfig);
            this._validateChatConfig(this.telegramConfig);
            this._validateSectionsConfig(this.telegramConfig, topics);
            this._validateAdditionalMessages(this.telegramConfig);
            this._validateDownloadConfig(this.telegramConfig);

            return this.telegramConfig;
        } catch (err) {
            throw new Error(`Failed to load telegram config: ${err.message}`);
        }
    }

    /**
     * Load authentication configuration
     * @returns {Promise<Object>} Authentication configuration object
     * @throws {Error} If config file is missing or required fields are missing
     */
    async loadAuthConfig() {
        if (this.authConfig) {
            return this.authConfig;
        }

        try {
            const configPath = path.join(this.baseDir, 'config', 'auth.yml');
            const configFile = await fs.readFile(configPath, 'utf8');
            this.authConfig = yaml.load(configFile);

            // Validate authentication configuration
            this._validateAuthConfig(this.authConfig);

            return this.authConfig;
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw new Error(
                    'Authentication config not found. Please copy ' +
                    'config/auth-example.yml to config/auth.yml ' +
                    'and fill in your phone number.',
                );
            }
            throw new Error(`Failed to load auth config: ${err.message}`);
        }
    }

    /**
     * Save authentication configuration to file
     * @param {Object} config - Authentication configuration object to save
     * @returns {Promise<void>}
     * @throws {Error} If config file cannot be written
     */
    async saveAuthConfig(config) {
        try {
            const configPath = path.join(this.baseDir, 'config', 'auth.yml');
            const yamlString = yaml.dump(config, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });
            await fs.writeFile(configPath, yamlString, 'utf8');
            this.authConfig = config; // Update cache
        } catch (err) {
            throw new Error(`Failed to save auth config: ${err.message}`);
        }
    }

    /**
     * Get API credentials from telegram config
     * @returns {Promise<Object>} API credentials object
     * @throws {Error} If telegram config cannot be loaded
     */
    async getApiCredentials() {
        const config = await this.loadTelegramConfig();
        return {
            api_id: config.api_id,
            api_hash: config.api_hash,
        };
    }

    /**
     * Get channel configuration
     * @returns {Promise<Object|undefined>} Channel configuration object or undefined if not found
     * @throws {Error} If telegram config cannot be loaded
     */
    async getChannel() {
        const config = await this.loadTelegramConfig();
        return config.channel;
    }

    /**
     * Get all sections from telegram config
     * @returns {Promise<Array>} Array of section configuration objects
     * @throws {Error} If telegram config cannot be loaded
     */
    async getSections() {
        const config = await this.loadTelegramConfig();
        const topics = await this._loadTopicsConfig();
        // Support both old and new format
        const sections = config.chat?.sections || config.sections;

        // Resolve each section from topics
        return sections.map(section => this._resolveSectionFromTopics(section, topics));
    }

    /**
     * Get section by slug
     * @param {string} slug - Section slug to find
     * @returns {Promise<Object|undefined>} Section configuration object or undefined if not found
     * @throws {Error} If telegram config cannot be loaded
     */
    async getSection(slug) {
        const sections = await this.getSections();
        return sections.find(s => s.slug === slug);
    }

    /**
     * Get chat name from telegram config
     * @returns {Promise<string>} Chat username
     * @throws {Error} If telegram config cannot be loaded
     */
    async getChatName() {
        const config = await this.loadTelegramConfig();
        // Support both old and new format
        return config.chat?.name || config.chat;
    }

    /**
     * Get additional messages
     * @returns {Array} Array of additional message configurations
     */
    async getAdditionalMessages() {
        const config = await this.loadTelegramConfig();
        return config.additionalMessages || [];
    }

    /**
     * Get download configuration with defaults
     * @returns {Object} Download configuration object
     */
    async getDownloadConfig() {
        const config = await this.loadTelegramConfig();
        return { ...DEFAULT_DOWNLOAD_CONFIG, ...config.download };
    }
}

// Export the class only
module.exports = { TelegramConfig };

