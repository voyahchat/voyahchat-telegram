#!/usr/bin/env node

/**
 * Bot-based pinned message synchronization
 * Syncs pinned messages from local markdown files to Telegram via Bot API
 *
 * @module telegram/bot-sync
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { BotApi } = require('./bot-api');
const { TopicsConfig, generateTitleLine } = require('./topics-config');
const { MarkdownConverter } = require('./markdown');
const { TelegramLogger } = require('./logger');
const { generateAndSaveFaq } = require('./faq-generator');

const CAPTION_MAX_LENGTH = 1024;

// Zero-width space toggled in force mode so each sync differs from the last
const FORCE_MARKER = '​';

/**
 * Check if error is caused by caption being too long
 * @param {Error} err - Error object
 * @returns {boolean}
 * @private
 */
function _isCaptionTooLong(err) {
    return err.message && err.message.includes('message caption is too long');
}

/**
 * Extract retry-after seconds from Bot API rate limit error
 * @param {string} message - Error message
 * @returns {number|null} Retry after seconds, or null if not a rate limit error
 * @private
 */
function _extractRetryAfter(message) {
    if (!message) return null;
    const match = message.match(/retry after (\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Bot-based pinned message synchronization class
 */
class BotSync {
    /**
     * Create a new BotSync instance
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.verbose=false] - Enable verbose output
     * @param {boolean} [options.dryRun=false] - Enable dry-run mode
     * @param {boolean} [options.force=false] - Force-refresh messages by toggling an invisible marker
     * @param {string} [options.token] - Bot token (or from TELEGRAM_BOT_TOKEN env)
     * @param {string|number} [options.chatId] - Chat ID (or from TELEGRAM_CHAT_ID env)
     * @param {string} [options.baseDir] - Base directory for config/data files
     * @param {BotApi} [options.botApi] - Injected BotApi instance (for testing)
     * @param {TopicsConfig} [options.topicsConfig] - Injected TopicsConfig (for testing)
     */
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.dryRun = options.dryRun || false;
        this.force = options.force || false;
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

        const maxRetries = 3;
        let skipImage = false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this._attemptSync(topic, skipImage);
            } catch (err) {
                // Caption too long → retry without image
                if (!skipImage && _isCaptionTooLong(err)) {
                    const html = this._lastHtml || '';
                    this.logger.actionComplete(
                        'warn',
                        topic.botPinnedId || 0,
                        `Caption too long (${html.length}/${CAPTION_MAX_LENGTH}). Retrying without image.`,
                    );
                    skipImage = true;
                    continue;
                }

                // Rate limit → wait and retry
                const retryAfter = _extractRetryAfter(err.message);
                if (retryAfter !== null && attempt < maxRetries) {
                    const wait = retryAfter + 1;
                    await this.logger.countdown(topic.botPinnedId || 0, wait, 'Rate limited, waiting');
                    continue;
                }

                // Unrecoverable error
                const firstLine = this._lastHtml ? this._lastHtml.split('\n')[0] : topic.title || topic.slug;
                const failLabel = `${firstLine} (topicId: ${topic.topicId})`;
                this.logger.actionComplete('failed', topic.botPinnedId || 0, failLabel);
                this.logger.actionComplete('error', topic.botPinnedId || 0, `${failLabel}: ${err.message}`);

                return {
                    slug: topic.slug,
                    title: topic.title,
                    action: 'failed',
                    error: err.message,
                };
            }
        }
    }

    /**
     * Single sync attempt (called by syncTopic with retry logic)
     * @param {Object} topic - Topic configuration object
     * @param {boolean} skipImage - If true, ignore associated image
     * @returns {Promise<Object>} Sync result
     * @private
     */
    async _attemptSync(topic, skipImage) {
        // Read local markdown content
        const localContent = await this.topicsConfig.readPinnedFile(topic.pinned);

        // Check for associated image
        let imagePath = skipImage ? null : await this.topicsConfig.getImagePath(topic.pinned);

        // Get latest modification date from git
        const modDate = await this.topicsConfig.getLatestModDate(topic.pinned);

        // Add title line if topic has title
        let contentWithTitle = localContent;
        if (topic.title) {
            const titleLine = generateTitleLine(topic.title, modDate);
            contentWithTitle = `${titleLine}\n\n${localContent}`;
        }

        // Read image bytes if image exists (needed for hash computation)
        let imageBytes = null;
        if (imagePath) {
            const absoluteImagePath = path.resolve(this.topicsConfig.baseDir, imagePath);
            imageBytes = await fs.readFile(absoluteImagePath);
        }

        // Compute content hash before any API calls
        let html = MarkdownConverter.toTelegramHtml(contentWithTitle);
        this._lastHtml = html;
        const firstLine = html.split('\n')[0];

        let contentHash;
        if (imageBytes) {
            contentHash = crypto.createHash('sha256')
                .update(html)
                .update(imageBytes)
                .digest('hex');
        } else {
            contentHash = crypto.createHash('sha256')
                .update(html)
                .digest('hex');
        }

        // Skip image if caption would exceed Telegram limit (photo caption = 1024 chars)
        if (imagePath && html.length > CAPTION_MAX_LENGTH) {
            this.logger.actionComplete(
                'warn',
                topic.botPinnedId || 0,
                `Caption too long (${html.length}/${CAPTION_MAX_LENGTH}). Skipping image.`,
            );
            imagePath = null;
            imageBytes = null;
            contentHash = crypto.createHash('sha256').update(html).digest('hex');
        }

        // Force mode: toggle an invisible marker so the payload always differs from the
        // last synced content, defeating Telegram's "message is not modified" check
        if (this.force) {
            const markedHtml = html + FORCE_MARKER;
            const markedHash = imageBytes
                ? crypto.createHash('sha256').update(markedHtml).update(imageBytes).digest('hex')
                : crypto.createHash('sha256').update(markedHtml).digest('hex');
            // If the last sync already carried the marker, drop it; otherwise add it
            if (topic.contentHash !== markedHash) {
                html = markedHtml;
                contentHash = markedHash;
                this._lastHtml = html;
            }
        }

        const result = {
            slug: topic.slug,
            title: topic.title,
            action: 'none',
            messageId: topic.botPinnedId || null,
        };

        if (topic.botPinnedId) {
            // Try to edit existing message
            const editResult = await this._editExisting(topic, html, imagePath, imageBytes, contentHash);
            result.action = editResult.action;
            result.messageId = editResult.messageId;
            if (editResult.contentHash !== undefined) {
                result.contentHash = editResult.contentHash;
            }
        } else {
            // Publish new message
            const newMessageId = await this._publishNew(topic, html, imagePath);
            result.action = 'created';
            result.messageId = newMessageId;
            result.contentHash = contentHash;
        }

        // Update config with new botPinnedId (only if something changed)
        if (!this.dryRun && result.action !== 'unchanged') {
            await this.topicsConfig.updateBotPinnedId(topic.slug, result.messageId);
        }

        // Update content hash after successful update
        if (!this.dryRun && result.contentHash) {
            await this.topicsConfig.updateContentHash(topic.slug, result.contentHash);
        }

        this.logger.actionComplete(result.action, result.messageId, firstLine);
        return result;
    }

    /**
     * Edit an existing bot message
     * @param {Object} topic - Topic object
     * @param {Object} telegram - Converted telegram content { text, entities }
     * @param {string|null} imagePath - Path to image file
     * @returns {Promise<{action: string, messageId: number}>} Result with action and messageId
     * @private
     */
    async _editExisting(topic, html, imagePath, imageBytes, contentHash) {
        // Check content hash locally before making any API call
        if (topic.contentHash && topic.contentHash === contentHash) {
            this.logger.debug(`Message ${topic.botPinnedId} already up to date (hash match)`);
            return { action: 'unchanged', messageId: topic.botPinnedId };
        }

        if (this.dryRun) {
            return { action: 'updated', messageId: topic.botPinnedId };
        }

        try {
            if (imagePath) {
                const absoluteImagePath = path.resolve(this.topicsConfig.baseDir, imagePath);
                try {
                    await this.api.editMessageMedia({
                        chatId: this.chatId,
                        messageId: topic.botPinnedId,
                        photoPath: absoluteImagePath,
                        caption: html,
                        parseMode: 'HTML',
                    });
                } catch (mediaErr) {
                    // Can't add image to text-only message — fall back to text edit
                    if (mediaErr.message && mediaErr.message.includes('there is no text')) {
                        await this.api.editMessageText({
                            chatId: this.chatId,
                            messageId: topic.botPinnedId,
                            text: html,
                            parseMode: 'HTML',
                        });
                    } else {
                        throw mediaErr;
                    }
                }
            } else {
                try {
                    await this.api.editMessageText({
                        chatId: this.chatId,
                        messageId: topic.botPinnedId,
                        text: html,
                        parseMode: 'HTML',
                    });
                } catch (textErr) {
                    // Existing message is a photo message (no text to edit) and we
                    // skipped the image (e.g. caption too long). Content is more
                    // important than the photo, so recreate as a text-only message.
                    if (BotApi.isMessageHasNoText(textErr)) {
                        this.logger.debug(
                            `Message ${topic.botPinnedId} is a photo with no text, recreating as text`,
                        );
                        const newId = await this._recreateAsText(topic, html);
                        return { action: 'recreated', messageId: newId, contentHash };
                    }
                    throw textErr;
                }
            }
            return { action: 'updated', messageId: topic.botPinnedId, contentHash };
        } catch (err) {
            if (BotApi.isMessageNotModified(err)) {
                this.logger.debug(`Message ${topic.botPinnedId} already up to date (Telegram 400)`);
                return { action: 'unchanged', messageId: topic.botPinnedId, contentHash };
            }

            if (BotApi.isMessageNotFound(err)) {
                this.logger.debug(`Message ${topic.botPinnedId} not found, creating new`);
                const newId = await this._publishNew(topic, html, null);
                return { action: 'recreated', messageId: newId, contentHash };
            }

            throw err;
        }
    }

    /**
     * Recreate an existing message as a text-only message
     * Deletes the old (photo) message and publishes a new text message, then pins it.
     * Used when the existing message is a photo that cannot be edited as text
     * (e.g. caption exceeds the photo caption limit). Content takes priority over image.
     * @param {Object} topic - Topic object
     * @param {string} html - HTML formatted text for Telegram
     * @returns {Promise<number>} New message ID
     * @private
     */
    async _recreateAsText(topic, html) {
        // Best-effort deletion of the old message; ignore failures (may already be gone)
        try {
            await this.api.deleteMessage({
                chatId: this.chatId,
                messageId: topic.botPinnedId,
            });
        } catch {
            // Ignore — proceed to publish a new message regardless
        }

        return this._publishNew(topic, html, null);
    }

    /**
     * Publish a new message and pin it
     * @param {Object} topic - Topic object
     * @param {string} html - HTML formatted text for Telegram
     * @param {string|null} imagePath - Path to image file
     * @returns {Promise<number>} New message ID
     * @private
     */
    /**
     * Get message thread params for Bot API
     * topicId 1 is the General topic and must not be passed as messageThreadId
     * @param {Object} topic - Topic object
     * @returns {Object} Params to spread into API call
     * @private
     */
    _getThreadParams(topic) {
        if (topic.topicId === 1) {
            return {};
        }
        return { messageThreadId: topic.topicId };
    }

    async _publishNew(topic, html, imagePath) {
        if (this.dryRun) {
            return 0;
        }

        const threadParams = this._getThreadParams(topic);
        let message;
        if (imagePath) {
            const absoluteImagePath = path.resolve(this.topicsConfig.baseDir, imagePath);
            try {
                message = await this.api.sendPhoto({
                    chatId: this.chatId,
                    photoPath: absoluteImagePath,
                    caption: html,
                    parseMode: 'HTML',
                    ...threadParams,
                });
            } catch (err) {
                if (_isCaptionTooLong(err)) {
                    throw err; // Let syncTopic retry without image
                }
                throw err;
            }
        } else {
            message = await this.api.sendMessage({
                chatId: this.chatId,
                text: html,
                parseMode: 'HTML',
                ...threadParams,
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

        // Separate faq topic — must be synced last after all botPinnedIds are updated
        const faqTopic = topics.find(t => t.slug === 'faq');
        const nonFaqTopics = topics.filter(t => t.slug !== 'faq');

        // Sync non-faq topics first
        for (const topic of nonFaqTopics) {
            const result = await this.syncTopic(topic);
            results.push(result);

            // Small delay between topics to respect rate limits
            if (!this.dryRun && results.length < nonFaqTopics.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        // Generate faq content with updated botPinnedIds, then sync
        if (faqTopic) {
            this.logger.debug('Generating FAQ content with updated pinned links...');
            try {
                await generateAndSaveFaq(this.topicsConfig);
            } catch (err) {
                this.logger.debug(`FAQ generation skipped: ${err.message}`);
            }

            const result = await this.syncTopic(faqTopic);
            results.push(result);
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
        force: false,
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
        case '--force':
        case '-f':
            options.force = true;
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
  -f, --force         Force-refresh each message (toggle an invisible marker)
  -t, --topic <slug>  Sync specific topic (can be used multiple times)

EXAMPLES:
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js --dry-run
  TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy node lib/bot-sync.js --force
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
            force: options.force,
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
