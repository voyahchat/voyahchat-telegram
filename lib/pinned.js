#!/usr/bin/env node

/**
 * Pinned message synchronization for Telegram
 * Syncs local markdown files with Telegram pinned messages
 *
 * @module telegram/pinned
 */

const fs = require('fs').promises;
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { CustomFile } = require('telegram/client/uploads');
const { TelegramConfig } = require('./config');
const { TopicsConfig } = require('./topics-config');
const { MarkdownConverter } = require('./markdown');
const { TelegramLogger, createTelegramClientLogger } = require('./logger');
const { extractFloodWaitTime, createClientStartOptions } = require('./telegram-utils');
const { toGramJS, validate: validateEntities } = require('./entity-converter');

/**
 * Pinned message synchronization class
 */
class PinnedSync {
    /**
     * Create a new PinnedSync instance
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.verbose=false] - Enable verbose output
     * @param {boolean} [options.dryRun=false] - Enable dry-run mode
     */
    constructor(options = {}) {
        this.client = null;
        this.verbose = options.verbose || false;
        this.dryRun = options.dryRun || false;

        // Initialize configuration
        this.telegramConfig = new TelegramConfig();
        this.topicsConfig = new TopicsConfig();

        // Initialize logger
        this.logger = new TelegramLogger({ verbose: this.verbose });

        // Allow dependency injection for testing
        this._createClient = options.createClient || null;
    }

    /**
     * Initialize Telegram client and authenticate
     * @returns {Promise<void>}
     * @throws {Error} If authentication fails
     */
    async init() {
        this.logger.debug('Initializing Telegram client for pinned sync...');

        const authConfig = await this.telegramConfig.loadAuthConfig();
        const apiCredentials = await this.telegramConfig.getApiCredentials();
        const downloadConfig = await this.telegramConfig.getDownloadConfig();

        // Use injected client factory if provided (for testing)
        if (this._createClient) {
            this.client = await this._createClient(authConfig, apiCredentials, downloadConfig);
            this.logger.debug('Telegram client initialized successfully!');
            return;
        }

        // Load session from config
        let session;
        if (authConfig.session && authConfig.session !== 'new_session') {
            session = new StringSession(authConfig.session);
        } else {
            session = new StringSession('');
        }

        const customLogger = createTelegramClientLogger(this.verbose);

        // Suppress console output in non-verbose mode to hide gramJS messages
        let originalConsole = null;
        if (!this.verbose) {
            originalConsole = {
                log: console.log,
                info: console.info,
                warn: console.warn,
                error: console.error,
            };

            // Override console methods to suppress gramJS output
            console.log = (...args) => {
                // Only allow our action logs through
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[EDIT]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[PUBLISH]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[DRY-RUN]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[UPDATED]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[CREATED]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[UNCHANGED]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[RECREATED]')) {
                    originalConsole.log(...args);
                }
                if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('[SUMMARY]')) {
                    originalConsole.log(...args);
                }
            };

            console.info = () => {};
            console.warn = () => {};
            console.error = () => {};
        }

        this.client = new TelegramClient(session, apiCredentials.api_id, apiCredentials.api_hash, {
            connectionRetries: downloadConfig.connectionRetries,
            retryDelay: downloadConfig.retryDelayBaseMs,
            timeout: downloadConfig.connectionTimeoutMs,
            logger: customLogger,
        });

        const startOptions = createClientStartOptions(authConfig, this.logger);
        await this.client.start(startOptions);

        // Save session to config
        const sessionString = this.client.session.save();
        authConfig.session = sessionString;
        await this.telegramConfig.saveAuthConfig(authConfig);

        // Restore console methods if we suppressed them
        if (!this.verbose && originalConsole) {
            console.log = originalConsole.log;
            console.info = originalConsole.info;
            console.warn = originalConsole.warn;
            console.error = originalConsole.error;
        }

        this.logger.debug('Telegram client initialized successfully!');
    }


    /**
     * Get chat entity by username from config
     * @returns {Promise<Object>} Telegram chat entity
     */
    async getChat() {
        const chatName = await this.telegramConfig.getChatName();

        try {
            const result = await this.client.invoke(
                new Api.contacts.ResolveUsername({
                    username: chatName,
                }),
            );
            return result.chats[0];
        } catch (err) {
            if (err.message.includes('flood') || err.message.includes('FLOOD_WAIT')) {
                const waitTime = extractFloodWaitTime(err.message);
                this.logger.debug(`Rate limited. Waiting ${waitTime} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                return this.getChat(); // Retry after waiting
            }
            throw err;
        }
    }


    /**
     * Compare content between local file and Telegram message
     * @param {string} localContent - Local markdown content
     * @param {Object} message - Telegram message object
     * @returns {boolean} True if content is the same
     */
    compareContent(localContent, message) {
        if (!message || !message.message) {
            return false;
        }

        // Convert local markdown to Telegram format
        const localTelegram = MarkdownConverter.toTelegram(localContent);

        // Normalize text by removing trailing newlines (Telegram strips them)
        const normalizedLocalText = localTelegram.text.replace(/\n+$/, '');
        const normalizedMessageText = message.message.replace(/\n+$/, '');

        // Compare normalized text content
        if (normalizedLocalText !== normalizedMessageText) {
            return false;
        }

        // Calculate the difference in text length due to trailing newline removal
        const textLengthDiff = localTelegram.text.length - normalizedLocalText.length;

        // Compare entities
        if (!message.entities || message.entities.length === 0) {
            return localTelegram.entities.length === 0;
        }

        if (localTelegram.entities.length !== message.entities.length) {
            return false;
        }

        // Sort entities by offset for consistent comparison
        const sortedLocalEntities = [...localTelegram.entities].sort((a, b) => a.offset - b.offset);
        const sortedMessageEntities = [...message.entities].sort((a, b) => a.offset - b.offset);

        for (let i = 0; i < sortedLocalEntities.length; i++) {
            const localEntity = sortedLocalEntities[i];
            const messageEntity = sortedMessageEntities[i];

            // Use normalizeEntityType to properly map Telegram entity types
            const normalizedType = this.normalizeEntityType(messageEntity.className);

            // Adjust local entity offset if it's affected by trailing newline removal
            const adjustedLocalOffset = localEntity.offset >= normalizedLocalText.length
                ? localEntity.offset - textLengthDiff
                : localEntity.offset;

            if (localEntity.type !== normalizedType ||
                adjustedLocalOffset !== messageEntity.offset ||
                localEntity.length !== messageEntity.length) {
                return false;
            }

            // For text_link entities, also compare URL
            if (localEntity.type === 'text_link' && messageEntity.url) {
                if (localEntity.url !== messageEntity.url) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if error is MESSAGE_NOT_MODIFIED from Telegram API
     * This error means the message content is already identical - treat as success
     * @param {Error} err - Error object to check
     * @returns {boolean} True if error is MESSAGE_NOT_MODIFIED
     */
    isMessageNotModifiedError(err) {
        if (!err || !err.message || typeof err.message !== 'string') {
            return false;
        }
        return err.message.includes('MESSAGE_NOT_MODIFIED');
    }

    /**
     * Normalize Telegram entity className to standard type name
     * Maps Telegram API entity class names to our internal type names
     * @param {string} className - Telegram entity className (e.g., 'MessageEntityTextUrl')
     * @returns {string} Normalized type name (e.g., 'text_link')
     */
    normalizeEntityType(className) {
        if (!className) {
            return '';
        }

        // Map Telegram entity class names to standard type names
        const typeMap = {
            'MessageEntityBold': 'bold',
            'MessageEntityItalic': 'italic',
            'MessageEntityCode': 'code',
            'MessageEntityPre': 'pre',
            'MessageEntityTextUrl': 'text_link',
            'MessageEntityUrl': 'url',
            'MessageEntityMention': 'mention',
            'MessageEntityHashtag': 'hashtag',
            'MessageEntityBotCommand': 'bot_command',
            'MessageEntityEmail': 'email',
            'MessageEntityPhone': 'phone',
            'MessageEntityUnderline': 'underline',
            'MessageEntityStrike': 'strikethrough',
            'MessageEntitySpoiler': 'spoiler',
        };

        return typeMap[className] || className.replace('MessageEntity', '').toLowerCase();
    }

    /**
     * Prepare image file for upload to Telegram
     * @param {string} imagePath - Relative path to image file
     * @returns {Promise<CustomFile>} CustomFile instance ready for upload
     */
    async prepareImageForUpload(imagePath) {
        const absolutePath = path.resolve(this.topicsConfig.baseDir, imagePath);
        const stats = await fs.stat(absolutePath);
        const fileName = path.basename(absolutePath);

        return new CustomFile(fileName, stats.size, absolutePath);
    }

    /**
     * Edit an existing Telegram message
     * @param {Object} chat - Telegram chat entity
     * @param {number} messageId - Message ID to edit
     * @param {string} content - New content for the message
     * @param {string} [imagePath] - Path to image file (optional)
     * @returns {Promise<Object>} Updated message object
     */
    async editMessage(chat, messageId, content, imagePath = null, topicId = null) {
        // Convert markdown to Telegram format
        const telegramContent = MarkdownConverter.toTelegram(content);

        // Validate and convert entities to gramJS format
        validateEntities(telegramContent.entities);
        const formattingEntities = toGramJS(telegramContent.entities);

        // Build request parameters
        const params = {
            message: messageId,
            text: telegramContent.text,
            formattingEntities: formattingEntities,
            noWebpage: true,  // Disable link preview for pinned messages
        };

        // Log what would be done
        const mode = this.dryRun ? 'DRY-RUN' : 'EDIT';
        const preview = telegramContent.text.substring(0, 50);
        this.logger.action(mode, messageId, preview);
        this.logger.debug(`  Entities: ${formattingEntities.length}, TopicId: ${topicId || 'none'}`);

        if (this.dryRun) {
            return { id: messageId, message: content };
        }

        try {
            let result;
            if (imagePath) {
                // Prepare image file for upload
                const customFile = await this.prepareImageForUpload(imagePath);
                const uploadedFile = await this.client.uploadFile({
                    file: customFile,
                    workers: 1,
                });

                result = await this.client.editMessage(chat, {
                    ...params,
                    file: uploadedFile,
                });
            } else {
                // Edit text only
                result = await this.client.editMessage(chat, params);
            }

            this.logger.debug(`Successfully edited message ${messageId}`);
            return result;
        } catch (err) {
            this.logger.error(`Failed to edit message ${messageId}: ${err.message}`);
            throw err;
        }
    }

    /**
     * Publish a new Telegram message
     * @param {Object} chat - Telegram chat entity
     * @param {string} content - Content for the message
     * @param {string} [imagePath] - Path to image file (optional)
     * @returns {Promise<Object>} New message object
     */
    async publishMessage(chat, content, imagePath = null, topicId = null) {
        // Convert markdown to Telegram format
        const telegramContent = MarkdownConverter.toTelegram(content);

        // Validate and convert entities to gramJS format
        validateEntities(telegramContent.entities);
        const formattingEntities = toGramJS(telegramContent.entities);

        // Build request parameters
        const params = {
            message: telegramContent.text,
            formattingEntities: formattingEntities,
            noWebpage: true,  // Disable link preview for pinned messages
        };

        // Add replyTo for forum topics
        if (topicId) {
            params.replyTo = topicId;
        }

        // Log what would be done
        const mode = this.dryRun ? 'DRY-RUN' : 'PUBLISH';
        const preview = telegramContent.text.substring(0, 50);
        this.logger.action(mode, 0, preview);
        this.logger.debug(`  Entities: ${formattingEntities.length}, TopicId: ${topicId || 'none'}`);

        if (this.dryRun) {
            return { id: 0, message: content };
        }

        try {
            let result;
            if (imagePath) {
                // Prepare image file for upload
                const customFile = await this.prepareImageForUpload(imagePath);
                const uploadedFile = await this.client.uploadFile({
                    file: customFile,
                    workers: 1,
                });

                result = await this.client.sendMessage(chat, {
                    ...params,
                    file: uploadedFile,
                });
            } else {
                // Send text only
                result = await this.client.sendMessage(chat, params);
            }

            this.logger.debug(`Successfully published new message with ID ${result.id}`);
            return result;
        } catch (err) {
            this.logger.error(`Failed to publish message: ${err.message}`);
            throw err;
        }
    }

    /**
     * Sync a specific topic
     * @param {Object} topic - Topic configuration object
     * @returns {Promise<Object>} Sync result
     */
    async syncTopic(topic) {
        this.logger.debug(`\nSyncing topic: ${topic.title || topic.slug}`);

        try {
            // Read local content
            const localContent = await this.topicsConfig.readPinnedFile(topic.pinned);

            // Check for associated image
            const imagePath = await this.topicsConfig.getImagePath(topic.pinned);

            // Get chat
            const chat = await this.getChat();

            let result = {
                slug: topic.slug,
                title: topic.title,
                action: 'none',
                messageId: topic.pinnedId,
            };

            if (topic.pinnedId) {
                // Try to get existing message
                try {
                    const messages = await this.client.getMessages(chat, {
                        ids: [topic.pinnedId],
                    });

                    if (messages.length > 0 && messages[0]) {
                        const message = messages[0];

                        // Compare content AND image presence
                        const localHasImage = imagePath !== null;

                        // Check if message has actual image media (not just web page previews)
                        const messageHasImageMedia = message.media && (
                            message.media.className === 'MessageMediaPhoto' ||
                            (message.media.className === 'MessageMediaDocument' &&
                             message.media.document &&
                             message.media.document.mimeType &&
                             message.media.document.mimeType.startsWith('image/'))
                        );

                        const imageChanged = localHasImage !== messageHasImageMedia;

                        if (this.compareContent(localContent, message) && !imageChanged) {
                            this.logger.debug(`Content is already up to date for message ${topic.pinnedId}`);
                            result.action = 'unchanged';
                            this.logger.actionComplete(result.action, topic.pinnedId, topic.title || topic.slug);
                        } else {
                            if (imageChanged) {
                                this.logger.debug(
                                    `Image presence changed (local: ${localHasImage}, ` +
                                    `remote: ${messageHasImageMedia}), updating message ${topic.pinnedId}`,
                                );
                            } else {
                                this.logger.debug(`Content differs, updating message ${topic.pinnedId}`);
                            }
                            await this.editMessage(chat, topic.pinnedId, localContent, imagePath, topic.topicId);
                            result.action = 'updated';
                            this.logger.actionComplete(result.action, topic.pinnedId, topic.title || topic.slug);
                        }
                    } else {
                        this.logger.debug(`Message ${topic.pinnedId} not found, creating new message`);
                        const newMessage = await this.publishMessage(chat, localContent, imagePath, topic.topicId);

                        // Update configuration with new message ID
                        await this.topicsConfig.updatePinnedId(topic.slug, newMessage.id);

                        result.action = 'recreated';
                        result.messageId = newMessage.id;
                        this.logger.actionComplete(result.action, newMessage.id, topic.title || topic.slug);
                    }
                } catch (err) {
                    // Check if this is MESSAGE_NOT_MODIFIED error - means content is already identical
                    if (this.isMessageNotModifiedError(err)) {
                        this.logger.debug(
                            `Message ${topic.pinnedId} content is already up to date (MESSAGE_NOT_MODIFIED)`,
                        );
                        result.action = 'unchanged';
                        this.logger.actionComplete(result.action, topic.pinnedId, topic.title || topic.slug);
                    } else {
                        this.logger.error(`Error accessing message ${topic.pinnedId}: ${err.message}`);
                        this.logger.debug('Creating new message instead');
                        const newMessage = await this.publishMessage(chat, localContent, imagePath, topic.topicId);

                        // Update configuration with new message ID
                        await this.topicsConfig.updatePinnedId(topic.slug, newMessage.id);

                        result.action = 'recreated';
                        result.messageId = newMessage.id;
                        this.logger.actionComplete(result.action, newMessage.id, topic.title || topic.slug);
                    }
                }
            } else {
                // No pinned ID, create new message
                this.logger.debug('No pinned message ID, creating new message');
                const newMessage = await this.publishMessage(chat, localContent, imagePath, topic.topicId);

                // Update configuration with new message ID
                await this.topicsConfig.updatePinnedId(topic.slug, newMessage.id);

                result.action = 'created';
                result.messageId = newMessage.id;
                this.logger.actionComplete(result.action, newMessage.id, topic.title || topic.slug);
            }

            return result;
        } catch (err) {
            this.logger.error(`Failed to sync topic ${topic.slug}: ${err.message}`);
            this.logger.topicFailed(topic.title || topic.slug, err.message);
            throw err;
        }
    }

    /**
     * Sync all topics
     * @param {string[]} [topicSlugs] - Specific topic slugs to sync (optional)
     * @returns {Promise<Object[]>} Array of sync results
     */
    async syncAll(topicSlugs = null) {
        this.logger.debug('Starting pinned message synchronization...');

        let topics;
        if (topicSlugs && topicSlugs.length > 0) {
            // Get specific topics
            topics = [];
            for (const slug of topicSlugs) {
                const topic = await this.topicsConfig.getTopic(slug);
                if (topic) {
                    topics.push(topic);
                } else {
                    this.logger.warn(`Topic "${slug}" not found in configuration`);
                }
            }
        } else {
            // Get only topics with pinned file path
            topics = await this.topicsConfig.getTopicsWithPinned();
        }

        if (topics.length === 0) {
            this.logger.debug('No topics to sync');
            return [];
        }

        const results = [];

        for (const topic of topics) {
            try {
                const result = await this.syncTopic(topic);
                results.push(result);
            } catch (err) {
                // Continue with other topics even if one fails
                results.push({
                    slug: topic.slug,
                    title: topic.title,
                    action: 'failed',
                    error: err.message,
                });
            }
        }

        // Print summary
        this.printSummary(results);

        return results;
    }

    /**
     * Print sync summary
     * @param {Object[]} results - Array of sync results
     */
    printSummary(results) {
        const stats = {
            created: results.filter(r => r.action === 'created').length,
            updated: results.filter(r => r.action === 'updated').length,
            recreated: results.filter(r => r.action === 'recreated').length,
            unchanged: results.filter(r => r.action === 'unchanged').length,
            failed: results.filter(r => r.action === 'failed').length,
        };

        this.logger.syncSummary(stats);

        // In verbose mode, also show failed topics details
        if (this.verbose && stats.failed > 0) {
            this.logger.debug('\nFailed topics:');
            results.filter(r => r.action === 'failed').forEach(r => {
                this.logger.debug(`- ${r.title || r.slug}: ${r.error}`);
            });
        }
    }

    /**
     * Close client connection gracefully
     * @returns {Promise<void>}
     */
    async close() {
        if (this.client) {
            this.logger.debug('\nDisconnecting from Telegram...');

            // Suppress console output in non-verbose mode to hide gramJS disconnect messages
            if (!this.verbose) {
                // Save original console methods
                const originalConsole = {
                    log: console.log,
                    info: console.info,
                    warn: console.warn,
                    error: console.error,
                };

                // Override all console methods to suppress gramJS output
                console.log = () => {};
                console.info = () => {};
                console.warn = () => {};
                console.error = () => {};

                // Add a small delay to ensure gramJS messages are suppressed
                await new Promise(resolve => setTimeout(resolve, 100));

                try {
                    await this.client.disconnect();
                } catch (err) {
                    // Ignore timeout errors during disconnect
                    if (!err.message.includes('TIMEOUT')) {
                        // Restore console before logging error
                        console.log = originalConsole.log;
                        console.info = originalConsole.info;
                        console.warn = originalConsole.warn;
                        console.error = originalConsole.error;
                        this.logger.error('Disconnect error:', err.message);
                        // Suppress again after logging
                        console.log = () => {};
                        console.info = () => {};
                        console.warn = () => {};
                        console.error = () => {};
                    }
                }

                // Add another small delay to ensure all disconnect messages are suppressed
                await new Promise(resolve => setTimeout(resolve, 100));

                // Restore console methods
                console.log = originalConsole.log;
                console.info = originalConsole.info;
                console.warn = originalConsole.warn;
                console.error = originalConsole.error;
            } else {
                try {
                    await this.client.disconnect();
                } catch (err) {
                    // Ignore timeout errors during disconnect
                    if (!err.message.includes('TIMEOUT')) {
                        this.logger.error('Disconnect error:', err.message);
                    }
                }
            }
        }
    }
}

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        help: false,
        verbose: false,
        dryRun: false,
        topics: [],
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
        case '--help':
        case '-h':
            options.help = true;
            break;
        case '--verbose':
        case '-v':
            options.verbose = true;
            break;
        case '--dry-run':
        case '-n':
            options.dryRun = true;
            break;
        case '--topic':
        case '-t':
            if (i + 1 < args.length) {
                options.topics.push(args[++i]);
            }
            break;
        default:
            // Unknown argument
            break;
        }
    }

    return options;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Pinned Message Synchronization for Telegram

USAGE:
  node lib/pinned.js [OPTIONS]

OPTIONS:
  -h, --help          Show this help message
  -v, --verbose       Enable verbose output
  -n, --dry-run       Preview changes without applying them
  -t, --topic <slug>  Sync specific topic by slug (can be used multiple times)

EXAMPLES:
  node lib/pinned.js                    # Sync all topics
  node lib/pinned.js -t registration    # Sync only the registration topic
  node lib/pinned.js -v                 # Sync with verbose output
  node lib/pinned.js -n                 # Preview changes without applying them
  node lib/pinned.js -t registration -v # Sync registration topic with verbose output
`);
}

/**
 * Main function
 */
async function main() {
    const options = parseArgs();

    if (options.help) {
        printHelp();
        return;
    }

    const sync = new PinnedSync({
        verbose: options.verbose,
        dryRun: options.dryRun,
    });

    try {
        await sync.init();
        const results = await sync.syncAll(options.topics.length > 0 ? options.topics : null);
        await sync.close();

        // Force exit to avoid gramJS update loop timeout
        const failed = results.filter(r => r.action === 'failed').length;
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        sync.logger.error('Sync failed:', err.message);
        await sync.close();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { PinnedSync };
