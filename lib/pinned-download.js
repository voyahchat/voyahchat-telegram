#!/usr/bin/env node

/**
 * Pinned message download for Telegram
 * Downloads pinned messages from Telegram and saves them as markdown files
 *
 * @module telegram/pinned-download
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { TelegramConfig } = require('./config');
const { TopicsConfig } = require('./topics-config');
const { MarkdownConverter } = require('./markdown');
const { TelegramLogger, createTelegramClientLogger } = require('./logger');
const { extractFloodWaitTime, createClientStartOptions } = require('./telegram-utils');
const { LoggerGuard } = require('./logger-guard');

/**
 * Pinned message download class
 */
class PinnedDownload {
    /**
     * Create a new PinnedDownload instance
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.verbose=false] - Enable verbose output
     * @param {boolean} [options.dryRun=false] - Enable dry-run mode
     * @param {boolean} [options.force=false] - Force overwrite existing files
     */
    constructor(options = {}) {
        this.client = null;
        this.verbose = options.verbose || false;
        this.dryRun = options.dryRun || false;
        this.force = options.force || false;

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
        this.logger.debug('Initializing Telegram client for pinned download...');

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
        const guard = new LoggerGuard({ enabled: !this.verbose });
        guard.suppress();

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

        // Restore console methods
        guard.restore();

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
                return this.getChat();
            }
            throw err;
        }
    }

    /**
     * Download a single pinned message from Telegram
     * @param {Object} chat - Telegram chat entity
     * @param {number} messageId - Message ID to download
     * @returns {Promise<Object>} Object with text, entities, and media info
     */
    async downloadMessage(chat, messageId) {
        try {
            const messages = await this.client.getMessages(chat, {
                ids: [messageId],
            });

            if (messages.length === 0 || !messages[0]) {
                throw new Error(`Message ${messageId} not found`);
            }

            const message = messages[0];

            return {
                id: message.id,
                text: message.message || '',
                entities: message.entities || [],
                media: message.media || null,
                date: message.date,
            };
        } catch (err) {
            if (err.message.includes('flood') || err.message.includes('FLOOD_WAIT')) {
                const waitTime = extractFloodWaitTime(err.message);
                this.logger.debug(`Rate limited. Waiting ${waitTime} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                return this.downloadMessage(chat, messageId);
            }
            throw err;
        }
    }

    /**
     * Download image from message media
     * @param {Object} message - Telegram message object with media
     * @returns {Promise<Object|null>} Object with buffer and extension, or null
     */
    async downloadImage(message) {
        if (!message.media) {
            return null;
        }

        // Check if media is a photo
        const mediaClassName = message.media.className;
        if (mediaClassName !== 'MessageMediaPhoto') {
            this.logger.debug(`  Media type ${mediaClassName} is not a photo, skipping`);
            return null;
        }

        try {
            const buffer = await this.client.downloadMedia(message.media);
            if (!buffer) {
                return null;
            }

            // Photos are always JPEG in Telegram
            return { buffer, extension: 'jpg' };
        } catch (err) {
            this.logger.error(`Failed to download image: ${err.message}`);
            return null;
        }
    }

    /**
     * Download a specific topic's pinned message
     * @param {Object} topic - Topic configuration object
     * @returns {Promise<Object>} Download result
     */
    async downloadTopic(topic) {
        this.logger.topicProgress(topic.title || topic.slug);
        this.logger.debug(`\nDownloading pinned message for: ${topic.title || topic.slug}`);

        const result = {
            slug: topic.slug,
            title: topic.title,
            action: 'none',
            pinnedId: topic.pinnedId,
            pinnedPath: null,
        };

        try {
            // Check if file already exists
            const expectedPath = `data/pinned/${topic.slug}.md`;

            if (!this.force) {
                try {
                    const existingPath = topic.pinned || expectedPath;
                    await this.topicsConfig.readPinnedFile(existingPath);
                    this.logger.debug(`  File already exists: ${existingPath}`);
                    this.logger.debug('  Use --force to overwrite');
                    result.action = 'skipped';
                    result.pinnedPath = existingPath;
                    this.logger.topicComplete(topic.title || topic.slug);
                    return result;
                } catch {
                    // File doesn't exist, continue with download
                }
            }

            // Get chat
            const chat = await this.getChat();

            // Download message
            this.logger.debug(`  Downloading message ${topic.pinnedId}...`);
            const message = await this.downloadMessage(chat, topic.pinnedId);

            // Convert to markdown
            const markdown = MarkdownConverter.fromTelegram(message.text, message.entities);

            // Log preview
            const preview = markdown.substring(0, 100).replace(/\n/g, ' ');
            this.logger.debug(`  Content preview: ${preview}...`);

            if (this.dryRun) {
                this.logger.debug(`  [DRY-RUN] Would save to: ${expectedPath}`);
                result.action = 'dry-run';
                result.pinnedPath = expectedPath;
            } else {
                // Save markdown file
                await this.topicsConfig.writePinnedFile(expectedPath, markdown);
                this.logger.debug(`  Saved: ${expectedPath}`);

                // Download and save image if present
                const imageData = await this.downloadImage(message);
                if (imageData) {
                    const imagePath = `data/pinned/${topic.slug}.${imageData.extension}`;
                    await this.topicsConfig.writeImageFile(imagePath, imageData.buffer);
                    this.logger.debug(`  Saved image: ${imagePath}`);
                }

                // Update topics.yml with pinned path
                await this.topicsConfig.updatePinnedPath(topic.slug, expectedPath);
                this.logger.debug('  Updated topics.yml');

                result.action = 'downloaded';
                result.pinnedPath = expectedPath;
            }

            this.logger.topicComplete(topic.title || topic.slug);
            return result;
        } catch (err) {
            this.logger.error(`Failed to download topic ${topic.slug}: ${err.message}`);
            this.logger.topicFailed(topic.title || topic.slug, err.message);
            result.action = 'failed';
            result.error = err.message;
            return result;
        }
    }

    /**
     * Download all pinned messages
     * @param {string[]} [topicSlugs] - Specific topic slugs to download (optional)
     * @returns {Promise<Object[]>} Array of download results
     */
    async downloadAll(topicSlugs = null) {
        this.logger.debug('Starting pinned message download...');

        let topics;
        if (topicSlugs && topicSlugs.length > 0) {
            // Get specific topics
            topics = [];
            for (const slug of topicSlugs) {
                const topic = await this.topicsConfig.getTopic(slug);
                if (topic) {
                    if (topic.pinnedId) {
                        topics.push(topic);
                    } else {
                        this.logger.warn(`Topic "${slug}" has no pinnedId, skipping`);
                    }
                } else {
                    this.logger.warn(`Topic "${slug}" not found in configuration`);
                }
            }
        } else {
            // Get all topics with pinnedId
            topics = await this.topicsConfig.getTopicsWithPinnedId();
        }

        if (topics.length === 0) {
            this.logger.debug('No topics to download');
            return [];
        }

        this.logger.debug(`Found ${topics.length} topics with pinned messages`);

        const results = [];

        for (const topic of topics) {
            const result = await this.downloadTopic(topic);
            results.push(result);

            // Small delay between downloads to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Print summary
        this.printSummary(results);

        return results;
    }

    /**
     * Print download summary
     * @param {Object[]} results - Array of download results
     */
    printSummary(results) {
        const stats = {
            downloaded: results.filter(r => r.action === 'downloaded').length,
            skipped: results.filter(r => r.action === 'skipped').length,
            dryRun: results.filter(r => r.action === 'dry-run').length,
            failed: results.filter(r => r.action === 'failed').length,
        };

        this.logger.downloadSummary(stats);

        // Still show failed topics details in verbose mode
        if (this.verbose && stats.failed > 0) {
            this.logger.info('\nFailed topics:');
            results.filter(r => r.action === 'failed').forEach(r => {
                this.logger.info(`- ${r.title || r.slug}: ${r.error}`);
            });
        }

        // Show tip in verbose mode if files were skipped
        if (this.verbose && stats.skipped > 0 && !this.force) {
            this.logger.info('\nTip: Use --force to overwrite existing files');
        }
    }

    /**
     * Close client connection gracefully
     * @returns {Promise<void>}
     */
    async close() {
        if (this.client) {
            this.logger.debug('\nDisconnecting from Telegram...');

            const guard = new LoggerGuard({ enabled: !this.verbose });

            try {
                await guard.run(async () => {
                    await this.client.disconnect();
                }, 100);
            } catch (err) {
                if (!err.message.includes('TIMEOUT')) {
                    this.logger.error('Disconnect error:', err.message);
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
Pinned Message Download for Telegram

Downloads pinned messages from Telegram and saves them as markdown files.

USAGE:
  node lib/pinned-download.js [OPTIONS]

OPTIONS:
  -h, --help          Show this help message
  -v, --verbose       Enable verbose output
  -n, --dry-run       Preview changes without downloading
  -f, --force         Force overwrite existing files
  -t, --topic <slug>  Download specific topic by slug (can be used multiple times)

EXAMPLES:
  node lib/pinned-download.js                    # Download all pinned messages
  node lib/pinned-download.js -t encars          # Download only encars topic
  node lib/pinned-download.js -v                 # Download with verbose output
  node lib/pinned-download.js -n                 # Preview what would be downloaded
  node lib/pinned-download.js -f                 # Force overwrite existing files
  node lib/pinned-download.js -t encars -t ma    # Download multiple specific topics

OUTPUT:
  Files are saved to data/pinned/{slug}.md
  Images are saved to data/pinned/{slug}.{ext}
  topics.yml is updated with pinned file paths
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

    const downloader = new PinnedDownload({
        verbose: options.verbose,
        dryRun: options.dryRun,
        force: options.force,
    });

    try {
        await downloader.init();
        const results = await downloader.downloadAll(options.topics.length > 0 ? options.topics : null);
        await downloader.close();

        // Force exit to avoid gramJS update loop timeout
        const failed = results.filter(r => r.action === 'failed').length;
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        downloader.logger.error('Download failed:', err.message);
        await downloader.close();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { PinnedDownload };
