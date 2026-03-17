// Standard library imports
const fs = require('fs').promises;
const path = require('path');

// Third-party imports
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

// Local module imports
const { TelegramConfig } = require('./config');
const { TelegramParser } = require('./parser');
const { DownloadStatistics, SectionDownloadStatistics } = require('./statistics');
const { TelegramLogger, createTelegramClientLogger } = require('./logger');
const { LoggerGuard } = require('./logger-guard');
const {
    OUTPUT_DIRS,
    OUTPUT_FILES,
    SCRAPER_DIRS,
} = require('./constants');
const { WebScraper } = require('./scraper');
const { extractFloodWaitTime, createClientStartOptions } = require('./telegram-utils');
const { processMessageMedia } = require('./download-media');
const { calculateSectionSize } = require('./download-utils');
const { getExternalLinksStats, scrapeExternalLinks, formatLinksInfo } = require('./download-links');

/**
 * Telegram message downloader with resume capability and integrity checking
 *
 * @module telegram/download
 */
class TelegramDownloader {
    /**
     * Create a new Telegram downloader
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.outputDir='telegram'] - Output directory
     * @param {Object} [options.dir] - Directory utility instance (for testing)
     */
    constructor(options = {}) {
        this.client = null;
        this.outputDir = options.outputDir || 'downloaded';
        this.downloadedMessages = new Set();

        // Create config instance
        this.config = new TelegramConfig();
        this.downloadConfig = null;

        // Initialize statistics tracker
        this.stats = new DownloadStatistics({ verbose: options.verbose });

        // Initialize logger with verbose mode
        this.verbose = options.verbose || false;
        this.logger = new TelegramLogger({ verbose: this.verbose });

        // Initialize LoggerGuard for console suppression
        this.loggerGuard = new LoggerGuard({ enabled: true });

        // Initialize web scraper for external links
        this.scraper = new WebScraper({
            verbose: this.verbose,
            logger: this.logger,
        });
    }

    /**
     * Get download configuration, loading it lazily if needed
     * @returns {Promise<Object>} Download configuration
     * @throws {Error} If config cannot be loaded
     */
    async getDownloadConfig() {
        if (!this.downloadConfig) {
            this.downloadConfig = await this.config.getDownloadConfig();
        }
        return this.downloadConfig;
    }

    /**
     * Log message if not in test environment
     * @param {...any} args - Arguments to pass to console.log
     */
    log(...args) {
        this.logger.debug(...args);
    }

    /**
     * Log warning if not in test environment
     * @param {...any} args - Arguments to pass to console.warn
     */
    warn(...args) {
        this.logger.warn(...args);
    }

    /**
     * Log error if not in test environment
     * @param {...any} args - Arguments to pass to console.error
     */
    error(...args) {
        this.logger.error(...args);
    }

    /**
     * Initialize Telegram client and authenticate
     * Prompts for verification code and 2FA password if needed
     * Saves session to config file after successful authentication
     * @returns {Promise<void>}
     * @throws {Error} If authentication fails
     */
    async init() {
        // Initialize LoggerGuard to suppress gramJS console output
        this.loggerGuard.suppress();

        const authConfig = await this.config.loadAuthConfig();
        const apiCredentials = await this.config.getApiCredentials();

        // Load session from config
        let session;
        if (authConfig.session && authConfig.session !== 'new_session') {
            session = new StringSession(authConfig.session);
        } else {
            session = new StringSession('');
        }

        const downloadConfig = await this.getDownloadConfig();

        const customLogger = createTelegramClientLogger(this.verbose);

        this.client = new TelegramClient(session, apiCredentials.api_id, apiCredentials.api_hash, {
            connectionRetries: downloadConfig.connectionRetries,
            retryDelay: downloadConfig.retryDelayBaseMs,
            timeout: downloadConfig.connectionTimeoutMs,
            logger: customLogger,
        });
        this.log('Starting Telegram client...');

        const startOptions = createClientStartOptions(authConfig, this.logger);
        await this.client.start(startOptions);
        this.log('Client started successfully!');

        // Save session to config
        const sessionString = this.client.session.save();
        authConfig.session = sessionString;
        await this.config.saveAuthConfig(authConfig);
        this.log('Session saved to config file');
    }


    /**
     * Check if session is valid by testing connection
     * @returns {Promise<boolean>} True if session is valid
     */
    async checkSessionValidity() {
        try {
            // Try to get self info - this will fail if session is invalid
            await this.client.getMe();
            return true;
        } catch (err) {
            if (err.errorMessage === 'API_ID_INVALID' || err.errorMessage === 'AUTH_KEY_PERM_EMPTY') {
                return false;
            }
            // For other errors, assume session might be valid
            return true;
        }
    }

    /**
     * Get chat entity by username from config
     * @returns {Promise<Object>} Telegram chat entity
     */
    async getChat() {
        // Ensure client is connected with retry logic
        await this.ensureConnection();

        const chatName = await this.config.getChatName();

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
                this.log(`Rate limited. Waiting ${waitTime} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                return this.getChat(); // Retry after waiting
            }
            throw err;
        }
    }

    /**
     * Ensure client connection with stability check
     * @returns {Promise<void>}
     */
    async ensureConnection() {
        if (!this.client.connected) {
            this.log('Reconnecting to Telegram...');
            try {
                await this.client.connect();
                // Verify connection is stable
                await this.client.getMe();
                this.log('Connection verified and stable');
            } catch (err) {
                this.error(`Connection failed: ${err.message}`);
                throw err;
            }
        }
    }


    /**
     * Get channel entity by invite hash
     * @param {string} inviteHash - Invite hash from t.me/+HASH link
     * @returns {Promise<Object>} Telegram channel entity
     */
    async getChannel(inviteHash) {
        // Ensure client is connected with stability check
        await this.ensureConnection();

        try {
            // First check if already joined
            const result = await this.client.invoke(
                new Api.messages.CheckChatInvite({
                    hash: inviteHash,
                }),
            );

            // If ChatInviteAlready, we have access
            if (result.className === 'ChatInviteAlready') {
                return result.chat;
            }

            // If ChatInvite, need to join first
            if (result.className === 'ChatInvite') {
                this.log(`Joining channel: ${result.title}`);
                const joinResult = await this.client.invoke(
                    new Api.messages.ImportChatInvite({
                        hash: inviteHash,
                    }),
                );
                return joinResult.chats[0];
            }

            throw new Error(`Cannot access channel with hash: ${inviteHash}`);
        } catch (err) {
            if (err.message.includes('flood') || err.message.includes('FLOOD_WAIT')) {
                const waitTime = extractFloodWaitTime(err.message);
                this.log(`Rate limited. Waiting ${waitTime} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                return this.getChannel(inviteHash); // Retry after waiting
            }
            throw err;
        }
    }

    /**
     * Convert Telegram message to JSON format with media download
     * @param {Object} message - Telegram message object
     * @param {string} sectionDir - Section directory for media storage
     * @returns {Promise<Object>} Message in JSON format with media info
     */
    async messageToJson(message, sectionDir, sectionStats = null) {
        const json = {
            id: message.id,
            date: message.date ? (
                message.date instanceof Date ?
                    message.date.toISOString() :
                    new Date(message.date).toISOString()
            ) : new Date().toISOString(),
            text: message.message || '',
            entities: message.entities || [],
            media: [],
            referencedMessages: [],
        };

        // Download media if present
        if (message.media) {
            const downloadConfig = await this.getDownloadConfig();
            json.media = await processMessageMedia(
                this.client,
                message,
                sectionDir,
                downloadConfig,
                this.stats,
                sectionStats,
                this.log.bind(this),
            );
        }

        // Extract referenced messages from text
        if (message.message) {
            json.referencedMessages = TelegramParser.extractReferencedMessages(message.message);
        }

        // Convert to HTML for easier processing later
        if (message.message && message.entities) {
            // Simple entity to HTML conversion
            let html = message.message;
            const entities = [...message.entities].sort((a, b) => a.offset - b.offset);

            for (let i = entities.length - 1; i >= 0; i--) {
                const entity = entities[i];
                const before = html.substring(0, entity.offset);
                let text = html.substring(entity.offset, entity.offset + entity.length);
                const after = html.substring(entity.offset + entity.length);

                let tag = '';
                switch (entity.className) {
                case 'MessageEntityBold':
                    tag = 'strong';
                    break;
                case 'MessageEntityItalic':
                    tag = 'em';
                    break;
                case 'MessageEntityCode':
                    tag = 'code';
                    break;
                case 'MessageEntityPre':
                    tag = 'pre';
                    break;
                case 'MessageEntityUrl':
                case 'MessageEntityTextUrl':
                    tag = 'a';
                    text = `<a href="${entity.url || text}">${text}</a>`;
                    break;
                default:
                    tag = '';
                }

                if (tag && !text.includes('<')) {
                    html = before + `<${tag}>${text}</${tag}>` + after;
                }
            }

            json.rawHtml = html;
        } else {
            json.rawHtml = json.text;
        }

        // Extract external URLs for reference
        json.externalUrls = this.scraper.extractExternalUrls(json.text);

        return json;
    }

    /**
     * Download a specific message with caching
     * @param {Object} chat - Telegram chat entity
     * @param {number} messageId - Message ID to download
     * @param {string} sectionDir - Section directory path
     * @param {boolean} [isReferenced=false] - Whether this is a referenced message
     * @returns {Promise<Object|null>} Message JSON or null if failed
     */
    async downloadMessage(chat, messageId, sectionDir, isReferenced = false, sectionStats = null) {
        // Check if already downloaded in this session
        if (this.downloadedMessages.has(messageId)) {
            return null;
        }

        // Check if message file already exists
        const subDir = isReferenced ? OUTPUT_DIRS.referenced : '';
        const messageDir = subDir ? path.join(sectionDir, subDir) : sectionDir;
        const filePath = path.join(messageDir, `${messageId}.json`);

        try {
            await fs.access(filePath);
            // Message already exists, load it
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const messageData = JSON.parse(content);
                this.downloadedMessages.add(messageId);
                this.log(`  Using cached message ${messageId}${isReferenced ? ' (referenced)' : ''}`);
                this.stats.incrementMessages('skipped');
                if (sectionStats) {
                    const fileStats = await fs.stat(filePath);
                    sectionStats.addCachedMessage(fileStats.size);
                }
                return messageData;
            } catch (err) {
                this.log(`  Corrupted cache for message ${messageId}, re-downloading`);
            }
        } catch {
            // File doesn't exist, continue to download
        }

        try {
            const messages = await this.client.getMessages(chat, {
                ids: [messageId],
            });

            if (messages.length === 0) {
                this.warn(`Message ${messageId} not found`);
                return null;
            }

            const message = messages[0];
            if (!message) {
                this.log(`Message ${messageId} is null or undefined (deleted from Telegram)`);
                return null;
            }

            // Additional validation for message properties
            if (!message.id) {
                this.error(`Message ${messageId} has invalid or missing ID`);
                return null;
            }

            let messageJson;
            try {
                messageJson = await this.messageToJson(message, sectionDir, sectionStats);
            } catch (processErr) {
                this.error(`Failed to process message ${messageId}: ${processErr.message}`);

                // Create a minimal message object as fallback with safe property access
                messageJson = {
                    id: message.id || messageId,
                    date: message.date ? (
                        message.date instanceof Date ?
                            message.date.toISOString() :
                            new Date(message.date).toISOString()
                    ) : new Date().toISOString(),
                    text: message.message || '',
                    entities: message.entities || [],
                    media: [],
                    referencedMessages: [],
                    processingError: processErr.message,
                    rawHtml: message.message || '',
                };

                this.log(`Created fallback message object for ${messageId}`);
            }

            // Save message - ensure directory exists
            if (subDir) {
                await fs.mkdir(messageDir, { recursive: true });
            }

            await fs.writeFile(filePath, JSON.stringify(messageJson, null, 2));

            this.downloadedMessages.add(messageId);

            this.log(`Downloaded message ${messageId}${isReferenced ? ' (referenced)' : ''}`);
            this.stats.incrementMessages('downloaded');
            if (sectionStats) {
                const content = JSON.stringify(messageJson, null, 2);
                sectionStats.addNewMessage(Buffer.byteLength(content, 'utf8'));
            }
            if (isReferenced) {
                this.stats.incrementMessages('referenced');
            }
            return messageJson;
        } catch (err) {
            this.error(`Failed to download message ${messageId}: ${err.message}`);

            // Provide more context for common errors
            if (err.message.includes('MESSAGE_ID_INVALID')) {
                this.error(`  Message ID ${messageId} is invalid or does not exist`);
            } else if (err.message.includes('CHANNEL_PRIVATE')) {
                this.error('  No access to channel - check if you\'re a member');
            } else if (err.message.includes('CHAT_ADMIN_REQUIRED')) {
                this.error('  Admin privileges required to access this message');
            } else if (err.message.includes('timeout')) {
                this.error('  Request timed out - network issue or message too large');
            }

            this.stats.incrementMessages('failed');
            if (sectionStats) {
                sectionStats.addMissedMessage();
            }
            this.stats.addError(err, 'message-download', { messageId, isReferenced });
            return null;
        }
    }

    /**
     * Download all referenced messages recursively
     * Follows message links and downloads the entire chain
     * @param {Object} chat - Telegram chat entity
     * @param {number[]} messageIds - Array of message IDs to download
     * @param {string} sectionDir - Section directory path
     * @returns {Promise<Object[]>} Array of downloaded message objects
     */
    async downloadReferencedMessages(chat, messageIds, sectionDir, sectionStats = null) {
        const toDownload = [...messageIds];
        const downloaded = [];

        while (toDownload.length > 0) {
            const messageId = toDownload.shift();

            const message = await this.downloadMessage(chat, messageId, sectionDir, true, sectionStats);
            if (message) {
                downloaded.push(message);

                // Add new referenced messages to queue
                for (const refId of message.referencedMessages) {
                    if (!this.downloadedMessages.has(refId) && !toDownload.includes(refId)) {
                        toDownload.push(refId);
                    }
                }
            }
        }

        return downloaded;
    }

    /**
     * Download a section with resume capability and integrity checking
     * @param {Object} section - Section configuration object
     * @returns {Promise<Object|null>} Section metadata or null if failed
     */
    async downloadSection(section) {
        this.logger.topicProgress(section.name);
        this.log(`\nDownloading section: ${section.name}`);

        let success = false;
        try {
            const sectionDir = path.join(this.outputDir, OUTPUT_DIRS.sections, section.slug);
            await fs.mkdir(sectionDir, { recursive: true });

            // Create section statistics tracker
            const sectionStats = new SectionDownloadStatistics(section.name);

            // Check if section already exists and show current stats
            const linksStats = await getExternalLinksStats(sectionDir);
            const linksInfo = formatLinksInfo(linksStats);

            if (linksInfo.length > 0) {
                this.log(`[V] ${section.name} — current: ${linksInfo.join(', ')}`);
            }


            // If no pinnedMessageId, download entire topic
            if (!section.pinnedMessageId) {
                const result = await this.downloadEntireTopic(section, sectionDir);
                success = true;
                return result;
            }

            // For sections with pinnedMessageId, calculate existing directory size
            await calculateSectionSize(sectionDir, sectionStats, this.log.bind(this));

            // Check if section is already complete and validate integrity
            const metadataPath = path.join(sectionDir, OUTPUT_FILES.metadata);
            try {
                await fs.access(metadataPath);
                try {
                    const metadataContent = await fs.readFile(metadataPath, 'utf8');
                    const metadata = JSON.parse(metadataContent);
                    const pinnedPath = path.join(sectionDir, `${section.pinnedMessageId}.json`);

                    try {
                        await fs.access(pinnedPath);
                        // Validate pinned message
                        try {
                            const pinnedContent = await fs.readFile(pinnedPath, 'utf8');
                            const pinnedData = JSON.parse(pinnedContent);
                            if (!pinnedData.id || !pinnedData.text) {
                                throw new Error('Invalid pinned message format');
                            }

                            // Check if all referenced messages exist
                            const missingRefs = [];
                            if (pinnedData.referencedMessages && pinnedData.referencedMessages.length > 0) {
                                const referencedDir = path.join(sectionDir, OUTPUT_DIRS.referenced);
                                try {
                                    await fs.access(referencedDir);
                                    for (const refId of pinnedData.referencedMessages) {
                                        const refPath = path.join(referencedDir, `${refId}.json`);
                                        try {
                                            await fs.access(refPath);
                                            // Validate referenced message format
                                            try {
                                                const refContent = await fs.readFile(refPath, 'utf8');
                                                const refData = JSON.parse(refContent);
                                                if (!refData.id || !refData.text) {
                                                    missingRefs.push(refId);
                                                }
                                            } catch {
                                                missingRefs.push(refId);
                                            }
                                        } catch {
                                            missingRefs.push(refId);
                                        }
                                    }
                                } catch {
                                    missingRefs.push(...pinnedData.referencedMessages);
                                }
                            }

                            if (missingRefs.length > 0) {
                                this.log(`  Section incomplete: missing ${missingRefs.length} referenced messages`);
                                this.log(`  Missing IDs: ${missingRefs.join(', ')}`);
                            // Continue to download missing messages
                            } else {
                                this.log(
                                    '  Section already downloaded and validated ' +
                                `(${metadata.messageCount} messages)`,
                                );
                                this.log(`  Last downloaded: ${metadata.downloadedAt}`);

                                // Load existing messages into memory to avoid re-downloading
                                this.downloadedMessages.add(pinnedData.id);

                                // Calculate statistics for cached section
                                // Add pinned message stats
                                const pinnedFilePath = path.join(sectionDir, `${section.pinnedMessageId}.json`);
                                try {
                                    const pinnedFileStats = await fs.stat(pinnedFilePath);
                                    sectionStats.addCachedMessage(pinnedFileStats.size);
                                } catch {
                                    // Pinned file stats not available
                                }

                                const referencedDir = path.join(sectionDir, OUTPUT_DIRS.referenced);
                                try {
                                    const refFiles = await fs.readdir(referencedDir);
                                    for (const file of refFiles) {
                                        if (file.endsWith('.json')) {
                                            const msgId = parseInt(file.split('.')[0]);
                                            this.downloadedMessages.add(msgId);
                                            // Add referenced message stats
                                            const refFilePath = path.join(referencedDir, file);
                                            try {
                                                const refFileStats = await fs.stat(refFilePath);
                                                sectionStats.addCachedMessage(refFileStats.size);
                                            } catch {
                                                // File stats not available
                                            }
                                        }
                                    }
                                } catch {
                                // Referenced directory doesn't exist, that's ok
                                }

                                // Add media stats if media directory exists
                                const mediaDir = path.join(sectionDir, OUTPUT_DIRS.media);
                                try {
                                    const mediaFiles = await fs.readdir(mediaDir);
                                    for (const file of mediaFiles) {
                                        const mediaFilePath = path.join(mediaDir, file);
                                        try {
                                            const mediaFileStats = await fs.stat(mediaFilePath);
                                            if (mediaFileStats.isFile()) {
                                                sectionStats.addCachedBytes(mediaFileStats.size);
                                            }
                                        } catch {
                                            // Media file stats not available
                                        }
                                    }
                                } catch {
                                    // Media directory doesn't exist, that's ok
                                }

                                // Add external links stats
                                const cachedLinksStats = await getExternalLinksStats(sectionDir);
                                if (cachedLinksStats.totalLinks > 0) {
                                    sectionStats.addLinks(cachedLinksStats.totalLinks);
                                    sectionStats.addCachedBytes(cachedLinksStats.totalSize);
                                }

                                // Output section summary with statistics
                                this.logger.sectionSummary(section.name, sectionStats.format());
                                success = true;
                                return metadata;
                            }
                        } catch (err) {
                            this.log(`  Section validation failed: ${err.message}`);
                            this.log('  Re-downloading section...');
                        }
                    } catch {
                    // Pinned file doesn't exist, continue to download
                    }
                } catch (err) {
                    this.log('  Metadata corrupted, re-downloading section');
                }
            } catch {
            // Metadata doesn't exist, continue to download
            }

            const chat = await this.getChat();

            // Download pinned message with better error handling
            this.log(`Downloading pinned message ${section.pinnedMessageId} for section ${section.name}...`);
            const pinnedMessage = await this.downloadMessage(
                chat,
                section.pinnedMessageId,
                sectionDir,
                false,
                sectionStats,
            );

            if (!pinnedMessage) {
                // Check if message exists but is not accessible
                try {
                    this.log(`Checking if message ${section.pinnedMessageId} exists...`);
                    const messages = await this.client.getMessages(chat, {
                        ids: [section.pinnedMessageId],
                    });

                    if (messages.length === 0) {
                        this.log(`Message ${section.pinnedMessageId} does not exist or is not accessible`);
                        this.log(`Skipping section ${section.name} - pinned message not available`);
                        // Don't treat as error, just skip
                        return null;
                    } else if (messages[0] === null) {
                        this.log(`Message ${section.pinnedMessageId} was deleted from Telegram`);
                        this.log(`Skipping section ${section.name} - pinned message deleted`);
                        // Don't treat as error, just skip
                        return null;
                    } else {
                        const message = messages[0];

                        // Check if message is valid before accessing properties
                        if (!message) {
                            this.log(`Message ${section.pinnedMessageId} is null or undefined in response`);
                            this.log(`Skipping section ${section.name} - message invalid`);
                            // Don't treat as error, just skip
                            return null;
                        }

                        this.log(`Message ${section.pinnedMessageId} exists, analyzing...`);
                        this.log(`  Message ID: ${message.id || 'undefined'}`);
                        this.log(`  Message class: ${message.className || 'undefined'}`);
                        this.log(`  Has media: ${!!message.media}`);
                        this.log(`  Has text: ${!!message.message}`);
                        this.log(`  Date: ${message.date}`);

                        // Try to process the message directly to see where it fails
                        try {
                            this.log('Attempting direct message processing...');
                            const messageJson = await this.messageToJson(message, sectionDir, sectionStats);

                            // Save the message directly
                            const filePath = path.join(sectionDir, `${section.pinnedMessageId}.json`);
                            await fs.writeFile(filePath, JSON.stringify(messageJson, null, 2));

                            this.log(`Successfully processed and saved message ${section.pinnedMessageId}`);
                            return messageJson;
                        } catch (processErr) {
                            this.error(`Direct processing failed: ${processErr.message}`);
                            this.stats.addError(processErr, 'message-processing', {
                                messageId: section.pinnedMessageId,
                            });

                            // Try to save raw message data for debugging
                            try {
                                const rawPath = path.join(sectionDir, `${section.pinnedMessageId}.raw.json`);
                                await fs.writeFile(rawPath, JSON.stringify({
                                    id: message.id || section.pinnedMessageId,
                                    className: message.className || 'unknown',
                                    date: message.date,
                                    message: message.message || '',
                                    hasMedia: !!message.media,
                                    mediaType: message.media?.className || 'unknown',
                                }, null, 2));
                                this.log(`Saved raw message data to ${section.pinnedMessageId}.raw.json`);
                            } catch (saveErr) {
                                this.error(`Could not save raw data: ${saveErr.message}`);
                            }

                            // Still return null since we couldn't process the message
                            return null;
                        }
                    }
                } catch (verifyErr) {
                    this.error(`Could not verify message ${section.pinnedMessageId}: ${verifyErr.message}`);
                    this.stats.addError(verifyErr, 'message-verification', {
                        messageId: section.pinnedMessageId,
                    });
                    return null;
                }
            }

            // Download referenced messages
            if (pinnedMessage.referencedMessages.length > 0) {
                this.log(`Downloading ${pinnedMessage.referencedMessages.length} referenced messages...`);
                await this.downloadReferencedMessages(
                    chat,
                    pinnedMessage.referencedMessages,
                    sectionDir,
                    sectionStats,
                );
            }

            // Save section metadata
            const metadata = {
                slug: section.slug,
                name: section.name,
                topicId: section.topicId,
                pinnedMessageId: section.pinnedMessageId,
                downloadedAt: new Date().toISOString(),
                messageCount: this.downloadedMessages.size,
            };

            await fs.writeFile(
                path.join(sectionDir, OUTPUT_FILES.metadata),
                JSON.stringify(metadata, null, 2),
            );

            // Create a copy for pinned.json for compatibility
            const pinnedPath = path.join(sectionDir, `${section.pinnedMessageId}.json`);
            const pinnedLinkPath = path.join(sectionDir, OUTPUT_FILES.pinned);
            try {
                await fs.access(pinnedPath);
                try {
                    await fs.access(pinnedLinkPath);
                } catch {
                    await fs.copyFile(pinnedPath, pinnedLinkPath);
                }
            } catch {
            // Pinned file doesn't exist
            }

            this.stats.addSection(section.slug, {
                name: section.name,
                messageCount: metadata.messageCount,
                pinnedMessageId: section.pinnedMessageId,
            });

            // Get and log external links statistics for sections
            const finalLinksStats = await getExternalLinksStats(sectionDir);
            if (finalLinksStats.totalLinks > 0) {
                sectionStats.addLinks(finalLinksStats.totalLinks);
                sectionStats.addCachedBytes(finalLinksStats.totalSize);
            }

            // Calculate accurate section size using du command
            await calculateSectionSize(sectionDir, sectionStats, this.log.bind(this));

            // Output section summary with statistics
            this.logger.sectionSummary(section.name, sectionStats.format());

            // Log completion with statistics (already logged above)

            success = true;
            return metadata;
        } finally {
            // Mark topic as complete or failed
            if (success) {
                // Already marked as complete by sectionSummary
            } else {
                // Check if we have any actual errors (not just missing messages)
                const errors = this.stats.getErrors?.() || [];
                const hasRealErrors = errors.some(e =>
                    e.context !== 'message-verification' &&
                    e.context !== 'message-deleted' &&
                    e.context !== 'message-null');

                if (hasRealErrors) {
                    const lastError = this.stats.getLastError?.() || 'Unknown error';
                    this.logger.topicFailed(section.name, lastError);
                    this.log(`Section ${section.name} failed: ${lastError}`);
                } else {
                    // No real errors, just missing messages - mark as complete
                    this.logger.topicComplete(section.name);
                    this.log(`Section ${section.name} completed (some messages may be missing)`);
                }
            }
        }
    }

    /**
     * Download entire topic (all messages in a topic)
     * @param {Object} section - Section configuration
     * @param {string} sectionDir - Section directory path
     * @returns {Promise<Object>} Section metadata
     */
    async downloadEntireTopic(section, sectionDir) {
        const chat = await this.getChat();

        // Create section statistics tracker
        const sectionStats = new SectionDownloadStatistics(section.name);
        const downloadConfig = await this.getDownloadConfig();
        const allMessages = [];
        let offsetId = 0;
        const limit = downloadConfig.messagesPerRequest;
        let hasMore = true;

        this.log(`Downloading all messages from topic ${section.topicId}...`);

        while (hasMore) {
            try {
                this.log(`Fetching messages (offset: ${offsetId})...`);

                const messages = await this.client.getMessages(chat, {
                    limit: limit,
                    offsetId: offsetId,
                    replyTo: section.topicId,
                });

                if (messages.length === 0) {
                    hasMore = false;
                    break;
                }

                this.log(`Downloaded ${messages.length} messages`);

                for (const message of messages) {
                    if (this.downloadedMessages.has(message.id)) {
                        continue;
                    }

                    // Check if message file already exists (cached)
                    const filePath = path.join(sectionDir, `${message.id}.json`);
                    let messageJson;

                    try {
                        await fs.access(filePath);
                        // Message already exists, load it and add to stats
                        const content = await fs.readFile(filePath, 'utf8');
                        messageJson = JSON.parse(content);
                        this.downloadedMessages.add(message.id);
                        this.log(`  Using cached message ${message.id}`);
                        this.stats.incrementMessages('skipped');
                        if (sectionStats) {
                            const fileStats = await fs.stat(filePath);
                            sectionStats.addCachedMessage(fileStats.size);
                        }
                        allMessages.push(messageJson);
                        continue;
                    } catch {
                        // File doesn't exist, continue with download
                    }

                    messageJson = await this.messageToJson(message, sectionDir, sectionStats);
                    allMessages.push(messageJson);

                    // Save message
                    const content = JSON.stringify(messageJson, null, 2);
                    await fs.writeFile(filePath, content);
                    this.downloadedMessages.add(message.id);
                    sectionStats.addNewMessage(Buffer.byteLength(content, 'utf8'));
                }

                offsetId = messages[messages.length - 1].id;

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, downloadConfig.rateLimitDelayMs));

            } catch (err) {
                this.error(`Error fetching messages: ${err.message}`);
                // Don't stop on error, just log and continue
                hasMore = false;
            }
        }

        // Download reply if specified
        if (section.replyToId) {
            this.log(`Downloading reply message ${section.replyToId}...`);
            await this.downloadMessage(chat, section.replyToId, sectionDir, true, sectionStats);
        }

        // Save section metadata
        const metadata = {
            slug: section.slug,
            name: section.name,
            topicId: section.topicId,
            replyToId: section.replyToId,
            downloadedAt: new Date().toISOString(),
            messageCount: allMessages.length,
            downloadType: 'entire-topic',
        };

        await fs.writeFile(
            path.join(sectionDir, OUTPUT_FILES.metadata),
            JSON.stringify(metadata, null, 2),
        );

        // Get and log external links statistics for entire topic
        const linksStats = await getExternalLinksStats(sectionDir);
        if (linksStats.totalLinks > 0) {
            sectionStats.addLinks(linksStats.totalLinks);
            sectionStats.addCachedBytes(linksStats.totalSize);
        }

        // Calculate accurate section size using du command
        await calculateSectionSize(sectionDir, sectionStats, this.log.bind(this));

        // Output section summary with statistics
        this.logger.sectionSummary(section.name, sectionStats.format());
        return metadata;
    }

    /**
     * Download channel with resume capability
     * Checks if already downloaded and validates integrity
     * @param {Object} channelConfig - Private channel configuration
     * @returns {Promise<Object|null>} Download metadata or null
     */
    async downloadChannel(channelConfig) {
        this.logger.topicProgress(channelConfig.name);
        this.log(`\nDownloading channel: ${channelConfig.name}`);

        let success = false;
        try {
            const channelDir = path.join(this.outputDir, 'private', channelConfig.slug);
            await fs.mkdir(channelDir, { recursive: true });

            // Create section statistics tracker
            const sectionStats = new SectionDownloadStatistics(channelConfig.name);

            // Load scraper cache for external links
            const linksBaseDir = path.join(channelDir, SCRAPER_DIRS.links);
            await this.scraper.loadCache(linksBaseDir);

            // Check if already downloaded and validate integrity
            const metadataPath = path.join(channelDir, OUTPUT_FILES.metadata);
            try {
                await fs.access(metadataPath);
                const metadataContent = await fs.readFile(metadataPath, 'utf8');
                const metadata = JSON.parse(metadataContent);

                // Validate by checking if message files exist
                const files = await fs.readdir(channelDir);
                const messageFiles = files.filter(f => f.endsWith('.json') && f !== 'metadata.json');

                if (messageFiles.length === metadata.messageCount) {
                    this.log(`  Private channel already downloaded (${metadata.messageCount} messages)`);
                    this.log(`  Last downloaded: ${metadata.downloadedAt}`);

                    // Calculate and display statistics for each message in the cached channel
                    // Sort message files by ID to ensure consistent order
                    messageFiles.sort((a, b) => {
                        const aId = parseInt(a.split('.')[0]);
                        const bId = parseInt(b.split('.')[0]);
                        return aId - bId;
                    });

                    // For cached channels, just show a summary every 100 messages
                    const batchSize = 100;
                    for (let i = 0; i < messageFiles.length; i += batchSize) {
                        const batch = messageFiles.slice(i, i + batchSize);
                        const batchStartId = parseInt(batch[0].split('.')[0]);
                        const batchEndId = parseInt(batch[batch.length - 1].split('.')[0]);

                        let batchStats = new SectionDownloadStatistics(`Messages ${batchStartId}-${batchEndId}`);

                        for (const file of batch) {
                            const messageId = parseInt(file.split('.')[0]);
                            const filePath = path.join(channelDir, file);

                            try {
                                const fileStats = await fs.stat(filePath);
                                batchStats.addCachedMessage(fileStats.size);

                                // Check for media files for this message
                                const mediaDir = path.join(channelDir, OUTPUT_DIRS.media);
                                try {
                                    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm', 'bin'];
                                    for (const ext of extensions) {
                                        const mediaFile = path.join(mediaDir, `${messageId}.${ext}`);
                                        try {
                                            await fs.access(mediaFile);
                                            const mediaStats = await fs.stat(mediaFile);
                                            batchStats.addCachedBytes(mediaStats.size);
                                            break;
                                        } catch {
                                            // No media file with this extension
                                        }
                                    }
                                } catch {
                                    // No media file for this message
                                }
                            } catch {
                                // Error processing this message
                            }
                        }

                        // Display batch statistics
                        this.logger.sectionSummary(
                            `Private Channel - Messages ${batchStartId}-${batchEndId}`,
                            batchStats.format(),
                        );
                    }

                    // Finally, display overall channel statistics
                    const overallStats = new SectionDownloadStatistics(channelConfig.name);
                    for (const file of messageFiles) {
                        const filePath = path.join(channelDir, file);
                        try {
                            const fileStats = await fs.stat(filePath);
                            overallStats.addCachedMessage(fileStats.size);
                        } catch {
                            // File stats not available
                        }
                    }

                    // Add media stats if media directory exists
                    const mediaDir = path.join(channelDir, OUTPUT_DIRS.media);
                    try {
                        const mediaFiles = await fs.readdir(mediaDir);
                        for (const file of mediaFiles) {
                            const mediaFilePath = path.join(mediaDir, file);
                            try {
                                const mediaFileStats = await fs.stat(mediaFilePath);
                                if (mediaFileStats.isFile()) {
                                    overallStats.addCachedBytes(mediaFileStats.size);
                                }
                            } catch {
                                // Media file stats not available
                            }
                        }
                    } catch {
                        // Media directory doesn't exist, that's ok
                    }

                    // Add external links stats
                    const linksStats = await getExternalLinksStats(channelDir);
                    if (linksStats.totalLinks > 0) {
                        overallStats.addLinks(linksStats.totalLinks);
                        overallStats.addCachedBytes(linksStats.totalSize);
                    }

                    // Calculate accurate section size using du command
                    await calculateSectionSize(channelDir, overallStats, this.log.bind(this));

                    // Output overall channel summary with statistics
                    this.logger.sectionSummary(channelConfig.name, overallStats.format());

                    success = true;
                    return metadata;
                }

                this.log('  Incomplete download detected, resuming...');
            } catch {
                // Metadata doesn't exist or is corrupted, continue to download
            }

            const channel = await this.getChannel(channelConfig.inviteHash);
            let offsetId = 0;
            const downloadConfig = await this.getDownloadConfig();
            const limit = downloadConfig.messagesPerRequest;
            let hasMore = true;

            while (hasMore) {
                this.log(`Fetching messages (offset: ${offsetId})...`);

                try {
                    const messages = await this.client.getMessages(channel, {
                        limit: limit,
                        offsetId: offsetId,
                    });

                    if (messages.length === 0) {
                        hasMore = false;
                        break;
                    }

                    this.log(`Downloaded ${messages.length} messages`);

                    for (const message of messages) {
                        // Check if message already exists (resume support)
                        const filePath = path.join(channelDir, `${message.id}.json`);
                        let messageStats = new SectionDownloadStatistics(`Private Channel message ${message.id}`);

                        try {
                            await fs.access(filePath);
                            this.log(`  Skipping existing message ${message.id}`);
                            this.downloadedMessages.add(message.id);
                            const fileStats = await fs.stat(filePath);
                            sectionStats.addCachedMessage(fileStats.size);
                            messageStats.addCachedMessage(fileStats.size);

                            // Check for media files for this cached message
                            const mediaDir = path.join(channelDir, OUTPUT_DIRS.media);
                            try {
                                const extensions = ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm', 'bin'];
                                for (const ext of extensions) {
                                    const mediaFile = path.join(mediaDir, `${message.id}.${ext}`);
                                    try {
                                        await fs.access(mediaFile);
                                        const mediaStats = await fs.stat(mediaFile);
                                        messageStats.addCachedBytes(mediaStats.size);
                                        break;
                                    } catch {
                                        // No media file with this extension
                                    }
                                }
                            } catch {
                                // No media file for this message
                            }
                        } catch {
                            // File doesn't exist, download it
                            try {
                                const messageJson = await this.messageToJson(message, channelDir, sectionStats);

                                const content = JSON.stringify(messageJson, null, 2);
                                await fs.writeFile(filePath, content);
                                this.downloadedMessages.add(message.id);
                                sectionStats.addNewMessage(Buffer.byteLength(content, 'utf8'));
                                messageStats.addNewMessage(Buffer.byteLength(content, 'utf8'));

                                // Add media size to message stats
                                if (messageJson.media && messageJson.media.length > 0) {
                                    for (const mediaItem of messageJson.media) {
                                        if (mediaItem.localPath) {
                                            try {
                                                const mediaPath = path.join(channelDir, mediaItem.localPath);
                                                const mediaStats = await fs.stat(mediaPath);
                                                messageStats.addNewBytes(mediaStats.size);
                                            } catch {
                                                // Media file not accessible
                                            }
                                        }
                                    }
                                }

                                // Scrape external links from message
                                await scrapeExternalLinks({
                                    scraper: this.scraper,
                                    messageJson,
                                    baseDir: channelDir,
                                    messageId: message.id,
                                    log: this.log.bind(this),
                                });

                                // Track external links
                                if (messageJson.externalUrls && messageJson.externalUrls.length > 0) {
                                    sectionStats.addLinks(messageJson.externalUrls.length);
                                    messageStats.addLinks(messageJson.externalUrls.length);
                                }
                            } catch (err) {
                                this.error(`Failed to process message ${message.id}: ${err.message}`);
                                this.stats.addError(err, 'channel-message', { messageId: message.id });
                                // Don't mark as failed, just log error and continue
                                this.log(`Skipping message ${message.id} due to error`);
                                messageStats.addMissedMessage();
                            }
                        }

                        // Output statistics for this message
                        this.logger.sectionSummary(`Private Channel message ${message.id}`, messageStats.format());
                    }

                    offsetId = messages[messages.length - 1].id;

                    // Rate limiting
                    await new Promise(resolve =>
                        setTimeout(resolve, downloadConfig.rateLimitDelayMs));
                } catch (err) {
                    this.error(`Error fetching messages from channel: ${err.message}`);
                    this.stats.addError(err, 'channel-fetch', { offsetId });
                    // Don't stop on error, just log and continue
                    hasMore = false;
                }
            }

            // Count total messages (including previously downloaded)
            const files = await fs.readdir(channelDir);
            const totalMessages = files.filter(f => f.endsWith('.json') && f !== 'metadata.json').length;

            // Save metadata
            const metadata = {
                slug: channelConfig.slug,
                name: channelConfig.name,
                inviteHash: channelConfig.inviteHash,
                downloadedAt: new Date().toISOString(),
                messageCount: totalMessages,
                downloadType: 'channel',
            };

            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

            // Save scraper cache
            await this.scraper.saveCache(linksBaseDir);

            // Get and log external links statistics
            const linksStats = await getExternalLinksStats(channelDir);
            if (linksStats.totalSize > 0) {
                sectionStats.addCachedBytes(linksStats.totalSize);
            }

            // Calculate accurate section size using du command
            await calculateSectionSize(channelDir, sectionStats, this.log.bind(this));

            // Output section summary with statistics
            this.logger.sectionSummary(channelConfig.name, sectionStats.format());
            success = true;
            return metadata;
        } finally {
            // Mark topic as complete or failed
            if (success) {
                // Already marked as complete by sectionSummary
            } else {
                // Check if we have any actual errors (not just missing messages)
                const errors = this.stats.getErrors?.() || [];
                const hasRealErrors = errors.some(e =>
                    e.context !== 'channel-message' &&
                    !(e.message && e.message.includes('not implemented')));

                if (hasRealErrors) {
                    const lastError = this.stats.getLastError?.() || 'Unknown error';
                    this.logger.topicFailed(channelConfig.name, lastError);
                    this.log(`Channel ${channelConfig.name} failed: ${lastError}`);
                } else {
                    // No real errors - mark as complete
                    this.logger.topicComplete(channelConfig.name);
                    this.log(`Channel ${channelConfig.name} completed`);
                }
            }
        }
    }


    /**
     * Download all sections with progress tracking
     */
    async downloadAll() {
        this.stats.start();
        const sections = await this.config.getSections();
        const results = [];

        // Create output directory
        try {
            await fs.access(this.outputDir);
        } catch {
            await fs.mkdir(this.outputDir, { recursive: true });
        }

        // Load existing index to track progress
        let existingIndex = null;
        const indexPath = path.join(this.outputDir, OUTPUT_FILES.index);
        try {
            await fs.access(indexPath);
            try {
                const indexContent = await fs.readFile(indexPath, 'utf8');
                existingIndex = JSON.parse(indexContent);
                this.log('\nResuming previous download...');
                const prevSectionsCount = Array.isArray(existingIndex.sections)
                    ? existingIndex.sections.length
                    : 0;
                this.log(`Previously downloaded sections: ${prevSectionsCount}`);
            } catch (err) {
                this.log('Could not load previous index, starting fresh');
            }
        } catch {
            // Index file doesn't exist, that's ok
        }

        for (const section of sections || []) {
            // Check if section exists in index but validate integrity
            if (existingIndex?.sections &&
                Array.isArray(existingIndex.sections) &&
                existingIndex.sections.some(s => s.slug === section.slug)) {
                this.log(`\nChecking ${section.name} for integrity...`);
                // downloadSection will validate and re-download if needed
            }

            const result = await this.downloadSection(section);
            if (result) {
                results.push(result);

                // Save progress after each section
                const partialIndex = {
                    chat: await this.config.getChatName(),
                    downloadedAt: new Date().toISOString(),
                    sections: results,
                    totalMessages: this.downloadedMessages.size,
                    downloadMethod: 'telegram-api',
                };

                await fs.writeFile(indexPath, JSON.stringify(partialIndex, null, 2));
                this.log(`  Progress saved (${results.length}/${sections.length} sections)`);
            }
        }

        // Download channel if configured
        const channelConfig = await this.config.getChannel();
        if (channelConfig) {
            // Add a clear separator between sections and channel download
            this.log('\n' + '='.repeat(60));
            this.log('Starting channel download...');
            this.log('='.repeat(60) + '\n');

            const privateResult = await this.downloadChannel(channelConfig);
            if (privateResult) {
                results.push({
                    ...privateResult,
                    type: 'channel',
                });
            }
        }

        // Save final index
        const index = {
            chat: await this.config.getChatName(),
            downloadedAt: new Date().toISOString(),
            sections: results,
            totalMessages: this.downloadedMessages.size,
        };

        await fs.writeFile(
            path.join(this.outputDir, OUTPUT_FILES.index),
            JSON.stringify(index, null, 2),
        );

        this.log('\nDownload complete!');
        this.log(`Total sections: ${results.length}`);
        this.log(`Total messages: ${this.downloadedMessages.size}`);
        this.log(`Output directory: ${this.outputDir}`);

        this.stats.stop();
        this.stats.printSummary();

        return index;
    }

    /**
     * Download additional messages
     */
    async downloadAdditionalMessages() {
        const messages = await this.config.getAdditionalMessages();
        if (messages.length === 0) {
            this.log('\nNo additional messages to download');
            return [];
        }

        this.log(`\nDownloading ${messages.length} additional messages...`);
        const results = [];
        const chat = await this.getChat();

        for (const msgConfig of messages) {
            this.log(`\nDownloading: ${msgConfig.name}`);

            // Create directory for this message
            const msgDir = path.join(this.outputDir, OUTPUT_DIRS.additional, msgConfig.slug);
            try {
                await fs.access(msgDir);
            } catch {
                await fs.mkdir(msgDir, { recursive: true });
            }

            // Download the main message
            const message = await this.downloadMessage(chat, msgConfig.messageId, msgDir);
            if (message) {
                results.push({
                    ...msgConfig,
                    message: message,
                });

                // Download referenced messages
                if (message.referencedMessages.length > 0) {
                    this.log(`Downloading ${message.referencedMessages.length} referenced messages...`);
                    await this.downloadReferencedMessages(chat, message.referencedMessages, msgDir);
                }

                // Download replies if specified
                if (msgConfig.downloadReplies && msgConfig.replyToId) {
                    this.log(`Downloading reply message ${msgConfig.replyToId}...`);
                    await this.downloadMessage(chat, msgConfig.replyToId, msgDir, true);
                }
            }
        }

        // Save metadata
        const metadataPath = path.join(this.outputDir, OUTPUT_DIRS.additional, OUTPUT_FILES.metadata);
        await fs.writeFile(metadataPath, JSON.stringify({
            downloadedAt: new Date().toISOString(),
            messages: results.map(r => ({
                name: r.name,
                slug: r.slug,
                messageId: r.messageId,
                hasReplies: r.downloadReplies,
            })),
        }, null, 2));

        this.log(`\nDownloaded ${results.length} additional messages`);
        return results;
    }

    /**
     * Download specific section by slug
     * @param {string} slug - Section slug from config
     * @returns {Promise<Object>} Section metadata
     * @throws {Error} If section not found in config
     */
    async downloadSectionBySlug(slug) {
        const section = await this.config.getSection(slug);
        if (!section) {
            throw new Error(`Section "${slug}" not found`);
        }

        return await this.downloadSection(section);
    }

    /**
     * Close client connection gracefully
     * Handles timeout errors during disconnect
     * @returns {Promise<void>}
     */
    async close() {
        if (this.client) {
            this.log('\nDisconnecting from Telegram...');
            try {
                // Force disconnect without waiting for updates
                await this.client.disconnect();
            } catch (err) {
                // Ignore timeout errors during disconnect
                if (!err.message.includes('TIMEOUT')) {
                    this.error('Disconnect error:', err.message);
                }
            }
        }

        // Restore console output using LoggerGuard
        this.loggerGuard.restore();
    }

}

// Run if called directly
if (require.main === module) {
    async function main() {
        const verbose = process.argv.includes('--verbose');
        const downloader = new TelegramDownloader({ verbose });

        try {
            await downloader.init();
            await downloader.downloadAll();
            await downloader.close();
            process.exit(0);
        } catch (err) {
            downloader.error('Download failed:', err.message);
            downloader.error('Full error:', err);
            await downloader.close();
            process.exit(1);
        }
    }

    main();
}
module.exports = TelegramDownloader;


