#!/usr/bin/env node

/**
 * Bot-based pinned message synchronization
 * Syncs pinned messages from local markdown files to Telegram via Bot API
 *
 * @module telegram/bot-sync
 */

const path = require('path');
const { BotApi } = require('./bot-api');
const { TopicsConfig } = require('./topics-config');
const { MarkdownConverter } = require('./markdown');
const { TelegramLogger } = require('./logger');

/**
 * Bot-based pinned message synchronization class
 */
class BotSync {
    /**
     * Create a new BotSync instance
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.verbose=false] - Enable verbose output
     * @param {boolean} [options.dryRun=false] - Enable dry-run mode
     * @param {string} [options.token] - Bot token (or from TELEGRAM_BOT_TOKEN env)
     * @param {string|number} [options.chatId] - Chat ID (or from TELEGRAM_CHAT_ID env)
     * @param {string} [options.baseDir] - Base directory for config/data files
     * @param {BotApi} [options.botApi] - Injected BotApi instance (for testing)
     * @param {TopicsConfig} [options.topicsConfig] - Injected TopicsConfig (for testing)
     */
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.dryRun = options.dryRun || false;
        this.logger = new TelegramLogger({ verbose: this.verbose });

        // Chat ID
        this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
        if (!this.chatId) {
            throw new Error('Chat ID is required (options.chatId or TELEGRAM_CHAT_ID env)');
        }

        // Bot API client (allow injection for testing)
        if (options.botApi) {
            this.api = options.botApi;
        } else {
            const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
            if (!token) {
                throw new Error('Bot token is required (options.token or TELEGRAM_BOT_TOKEN env)');
            }
            this.api = new BotApi(token);
        }

        // Topics config (allow injection for testing)
        this.topicsConfig = options.topicsConfig || new TopicsConfig(options.baseDir);
    }

    /**
     * Verify bot token is valid and bot has access to chat
     * @returns {Promise<Object>} Bot info
     */
    async verifyBot() {
        const botInfo = await this.api.getMe();
        this.logger.debug(`Bot verified: @${botInfo.username} (${botInfo.id})`);
        return botInfo;
    }

    /**
     * Sync a single topic
     * @param {Object} topic - Topic configuration object
     * @returns {Promise<Object>} Sync result { slug, title, action, messageId }
     */
    async syncTopic(topic) {
        this.logger.debug(`\nSyncing topic: ${topic.title || topic.slug}`);

        try {
            // Read local markdown content
            const localContent = await this.topicsConfig.readPinnedFile(topic.pinned);

            // Check for associated image
            const imagePath = await this.topicsConfig.getImagePath(topic.pinned);

            const result = {
                slug: topic.slug,
                title: topic.title,
                action: 'none',
                messageId: topic.botPinnedId || null,
            };

            // Convert markdown to Telegram HTML format
            const html = MarkdownConverter.toTelegramHtml(localContent);
            const firstLine = html.split('\n')[0];

            if (topic.botPinnedId) {
                // Try to edit existing message
                const editResult = await this._editExisting(topic, html, imagePath);
                result.action = editResult.action;
                result.messageId = editResult.messageId;
            } else {
                // Publish new message
                const newMessageId = await this._publishNew(topic, html, imagePath);
                result.action = 'created';
                result.messageId = newMessageId;
            }

            // Update config with new botPinnedId (only if something changed)
            if (!this.dryRun && result.action !== 'unchanged') {
                await this.topicsConfig.updateBotPinnedId(topic.slug, result.messageId);
            }

            this.logger.actionComplete(result.action, result.messageId, firstLine);
            return result;

        } catch (err) {
            this.logger.error(`Failed to sync topic ${topic.slug}: ${err.message}`);
            this.logger.topicFailed(topic.title || topic.slug, err.message);
            return {
                slug: topic.slug,
                title: topic.title,
                action: 'failed',
                error: err.message,
            };
        }
    }

    /**
     * Edit an existing bot message
     * @param {Object} topic - Topic object
     * @param {Object} telegram - Converted telegram content { text, entities }
     * @param {string|null} imagePath - Path to image file
     * @returns {Promise<{action: string, messageId: number}>} Result with action and messageId
     * @private
     */
    async _editExisting(topic, html, imagePath) {
        const mode = this.dryRun ? 'DRY-RUN' : 'EDIT';
        const preview = html.split('\n')[0];
        this.logger.action(mode, topic.botPinnedId, preview);

        if (this.dryRun) {
            return { action: 'updated', messageId: topic.botPinnedId };
        }

        try {
            if (imagePath) {
                const absoluteImagePath = path.resolve(this.topicsConfig.baseDir, imagePath);
                await this.api.editMessageMedia({
                    chatId: this.chatId,
                    messageId: topic.botPinnedId,
                    photoPath: absoluteImagePath,
                    caption: html,
                    parseMode: 'HTML',
                });
            } else {
                await this.api.editMessageText({
                    chatId: this.chatId,
                    messageId: topic.botPinnedId,
                    text: html,
                    parseMode: 'HTML',
                });
            }
            return { action: 'updated', messageId: topic.botPinnedId };
        } catch (err) {
            if (BotApi.isMessageNotModified(err)) {
                this.logger.debug(`Message ${topic.botPinnedId} already up to date`);
                return { action: 'unchanged', messageId: topic.botPinnedId };
            }

            if (BotApi.isMessageNotFound(err)) {
                this.logger.debug(`Message ${topic.botPinnedId} not found, creating new`);
                const newId = await this._publishNew(topic, html, imagePath);
                return { action: 'recreated', messageId: newId };
            }

            throw err;
        }
    }

    /**
     * Publish a new message and pin it
     * @param {Object} topic - Topic object
     * @param {string} html - HTML formatted text for Telegram
     * @param {string|null} imagePath - Path to image file
     * @returns {Promise<number>} New message ID
     * @private
     */
    async _publishNew(topic, html, imagePath) {
        const mode = this.dryRun ? 'DRY-RUN' : 'PUBLISH';
        const preview = html.split('\n')[0];
        this.logger.action(mode, 0, preview);

        if (this.dryRun) {
            return 0;
        }

        let message;
        if (imagePath) {
            const absoluteImagePath = path.resolve(this.topicsConfig.baseDir, imagePath);
            message = await this.api.sendPhoto({
                chatId: this.chatId,
                photoPath: absoluteImagePath,
                caption: html,
                parseMode: 'HTML',
                messageThreadId: topic.topicId,
            });
        } else {
            message = await this.api.sendMessage({
                chatId: this.chatId,
                text: html,
                parseMode: 'HTML',
                messageThreadId: topic.topicId,
            });
        }

        // Pin the message
        await this.api.pinChatMessage({
            chatId: this.chatId,
            messageId: message.message_id,
            disableNotification: true,
        });

        // Try to delete the "Bot pinned a message" service message
        try {
            await this.api.deleteMessage({
                chatId: this.chatId,
                messageId: message.message_id + 1,
            });
        } catch {
            // Service message may not exist or bot may lack permission — ignore
        }

        this.logger.debug(`Published and pinned message ${message.message_id} in topic ${topic.topicId}`);
        return message.message_id;
    }

    /**
     * Sync all topics (or specific slugs)
     * @param {string[]} [topicSlugs] - Specific slugs to sync (null = all)
     * @returns {Promise<Object[]>} Array of sync results
     */
    async syncAll(topicSlugs = null) {
        this.logger.debug('Starting bot pinned message synchronization...');

        let topics;
        if (topicSlugs && topicSlugs.length > 0) {
            topics = [];
            for (const slug of topicSlugs) {
                const topic = await this.topicsConfig.getTopic(slug);
                if (topic && topic.pinned) {
                    topics.push(topic);
                } else if (topic && !topic.pinned) {
                    this.logger.warn(`Topic "${slug}" has no pinned file`);
                } else {
                    this.logger.warn(`Topic "${slug}" not found`);
                }
            }
        } else {
            topics = await this.topicsConfig.getTopicsForBotSync();
        }

        if (topics.length === 0) {
            this.logger.debug('No topics to sync');
            return [];
        }

        const results = [];
        const DELAY_MS = 500; // Delay between API calls to respect rate limits

        for (const topic of topics) {
            const result = await this.syncTopic(topic);
            results.push(result);

            // Small delay between topics to respect rate limits
            if (!this.dryRun && results.length < topics.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

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

        if (!this.logger.isTest) {
            console.log('');
        }
        this.logger.syncSummary(stats);
    }
}

// --- CLI ---

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
        }
    }

    return options;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Bot Pinned Message Synchronization

USAGE:
  node lib/bot-sync.js [OPTIONS]

ENVIRONMENT:
  TELEGRAM_BOT_TOKEN   Bot token from BotFather (required)
  TELEGRAM_CHAT_ID     Target chat ID (required)

OPTIONS:
  -h, --help          Show this help message
  -v, --verbose       Enable verbose output
  -n, --dry-run       Preview changes without applying them
  -t, --topic <slug>  Sync specific topic (can be used multiple times)

EXAMPLES:
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js --dry-run
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js -t registration
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

    try {
        const sync = new BotSync({
            verbose: options.verbose,
            dryRun: options.dryRun,
        });

        if (!options.dryRun) {
            await sync.verifyBot();
        }
        const results = await sync.syncAll(options.topics.length > 0 ? options.topics : null);

        const failed = results.filter(r => r.action === 'failed').length;
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(`Sync failed: ${err.message}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { BotSync };
