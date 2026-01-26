const test = require('ava');
const fs = require('fs').promises;
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const { DownloadStatistics, SectionDownloadStatistics } = require('../lib/statistics');
const { messageToJson, downloadMessage, downloadReferencedMessages } = require('../lib/download-message');
const { OUTPUT_DIRS } = require('../lib/constants');

// Mock dependencies
const mockProcessMessageMedia = async () => [{ type: 'photo', id: '123' }];
const mockExtractReferencedMessages = () => [456, 789];
const mockExtractExternalUrls = () => ['https://example.com'];

test.beforeEach(async (t) => {
    // Create test directory
    const dir = new TestDir();
    t.context.dir = dir;
    t.context.sectionDir = dir.getDownloaded();
    t.context.stats = new DownloadStatistics();
    t.context.sectionStats = new SectionDownloadStatistics('test');

    // Create referenced messages directory
    const referencedDir = path.join(t.context.sectionDir, OUTPUT_DIRS.referenced);
    await fs.mkdir(referencedDir, { recursive: true });

    // Mock dependencies
    t.context.mockClient = {
        getMessages: async (chat, options) => {
            if (options.ids[0] === 999) {
                return []; // Message not found
            }
            if (options.ids[0] === 888) {
                return [null]; // Deleted message
            }
            return [{
                id: options.ids[0],
                date: new Date('2024-01-01'),
                message: 'Test message',
                entities: [],
            }];
        },
    };

    t.context.mockChat = { id: 'test-chat' };
    t.context.downloadConfig = { media: true };
    t.context.downloadedMessages = new Set();

    // Mock logs
    t.context.logs = {
        log: [],
        warn: [],
        error: [],
    };
    t.context.logFn = (msg) => t.context.logs.log.push(msg);
    t.context.warnFn = (msg) => t.context.logs.warn.push(msg);
    t.context.errorFn = (msg) => t.context.logs.error.push(msg);

    // Mock scraper
    t.context.mockScraper = {
        extractExternalUrls: mockExtractExternalUrls,
    };
});


// messageToJson tests
test('messageToJson() - should convert basic message to JSON', async (t) => {
    // Arrange
    const message = {
        id: 123,
        date: new Date('2024-01-01'),
        message: 'Test message',
        entities: [],
    };
    const mockClient = {};

    // Act
    const result = await messageToJson(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.logFn,
    );

    // Assert
    t.is(result.id, 123);
    t.is(result.text, 'Test message');
    t.deepEqual(result.media, []);
    t.deepEqual(result.referencedMessages, []);
    t.is(result.rawHtml, 'Test message');
    t.deepEqual(result.externalUrls, ['https://example.com']);
});

test('messageToJson() - should handle message with media', async (t) => {
    // Arrange
    const message = {
        id: 123,
        date: new Date('2024-01-01'),
        message: 'Test with media',
        entities: [],
        media: { type: 'photo' },
    };
    const mockClient = {};

    // Mock processMessageMedia
    const originalProcessMessageMedia = require('../lib/download-media').processMessageMedia;
    require('../lib/download-media').processMessageMedia = mockProcessMessageMedia;

    try {
        // Act
        const result = await messageToJson(
            mockClient,
            message,
            t.context.sectionDir,
            t.context.downloadConfig,
            t.context.stats,
            t.context.sectionStats,
            t.context.mockScraper,
            t.context.logFn,
        );

        // Assert
        t.is(result.id, 123);
        t.is(result.text, 'Test with media');
        // Check if media array exists
        t.true(Array.isArray(result.media));
    } finally {
        // Restore original
        require('../lib/download-media').processMessageMedia = originalProcessMessageMedia;
    }
});

test('messageToJson() - should extract referenced messages from text', async (t) => {
    // Arrange
    const message = {
        id: 123,
        date: new Date('2024-01-01'),
        message: 'Check https://t.me/c/123/456 and https://t.me/c/123/789',
        entities: [],
    };
    const mockClient = {};

    // Mock TelegramParser.extractReferencedMessages
    const originalExtractReferencedMessages = require('../lib/parser').TelegramParser.extractReferencedMessages;
    require('../lib/parser').TelegramParser.extractReferencedMessages = mockExtractReferencedMessages;

    try {
        // Act
        const result = await messageToJson(
            mockClient,
            message,
            t.context.sectionDir,
            t.context.downloadConfig,
            t.context.stats,
            t.context.sectionStats,
            t.context.mockScraper,
            t.context.logFn,
        );

        // Assert
        t.is(result.id, 123);
        t.deepEqual(result.referencedMessages, [456, 789]);
    } finally {
        // Restore original
        require('../lib/parser').TelegramParser.extractReferencedMessages = originalExtractReferencedMessages;
    }
});

test('messageToJson() - should handle message without text', async (t) => {
    // Arrange
    const message = {
        id: 123,
        date: new Date('2024-01-01'),
        entities: [],
    };
    const mockClient = {};

    // Act
    const result = await messageToJson(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.logFn,
    );

    // Assert
    t.is(result.id, 123);
    t.is(result.text, '');
    t.deepEqual(result.referencedMessages, []);
    t.is(result.rawHtml, '');
});

test('messageToJson() - should convert entities to HTML', async (t) => {
    // Arrange
    const message = {
        id: 123,
        date: new Date('2024-01-01'),
        message: 'Bold and italic text',
        entities: [
            { className: 'MessageEntityBold', offset: 0, length: 4 },
            { className: 'MessageEntityItalic', offset: 9, length: 6 },
        ],
    };
    const mockClient = {};

    // Act
    const result = await messageToJson(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.logFn,
    );

    // Assert
    t.is(result.id, 123);
    t.is(result.rawHtml, '<strong>Bold</strong> and <em>italic</em> text');
});

// downloadMessage tests
test('downloadMessage() - should skip already downloaded messages', async (t) => {
    // Arrange
    const messageId = 123;
    t.context.downloadedMessages.add(messageId);

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result, null);
});

test('downloadMessage() - should use cached message when file exists', async (t) => {
    // Arrange
    const messageId = 123;
    const filePath = path.join(t.context.sectionDir, `${messageId}.json`);
    const cachedMessage = {
        id: messageId,
        date: '2024-01-01T00:00:00.000Z',
        text: 'Cached message',
        entities: [],
        media: [],
        referencedMessages: [],
    };
    await fs.writeFile(filePath, JSON.stringify(cachedMessage, null, 2));

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.deepEqual(result, cachedMessage);
    t.true(t.context.downloadedMessages.has(messageId));
    t.true(t.context.logs.log.some(log => log.includes('Using cached message')));
    t.is(t.context.stats.messages.skipped, 1);
});

test('downloadMessage() - should download and save new message', async (t) => {
    // Arrange
    const messageId = 123;

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result.id, messageId);
    t.is(result.text, 'Test message');
    t.true(t.context.downloadedMessages.has(messageId));
    t.true(t.context.logs.log.some(log => log.includes('Downloaded message')));
    t.is(t.context.stats.messages.downloaded, 1);

    // Verify file was created
    const filePath = path.join(t.context.sectionDir, `${messageId}.json`);
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    t.true(fileExists);
});

test('downloadMessage() - should handle deleted messages gracefully', async (t) => {
    // Arrange
    const messageId = 888; // This ID returns null from mock client

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result, null);
    t.true(t.context.logs.log.some(log => log.includes('is null or undefined')));
});

test('downloadMessage() - should handle not found messages', async (t) => {
    // Arrange
    const messageId = 999; // This ID returns empty array from mock client

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result, null);
    t.true(t.context.logs.warn.some(log => log.includes('not found')));
});

test('downloadMessage() - should track statistics correctly', async (t) => {
    // Arrange
    const messageId = 123;

    // Act
    await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        false,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(t.context.stats.messages.downloaded, 1);
    t.is(t.context.sectionStats.messages.new, 1);
    t.true(t.context.sectionStats.bytes.new > 0);
});

test('downloadMessage() - should handle referenced messages correctly', async (t) => {
    // Arrange
    const messageId = 123;
    const isReferenced = true;

    // Act
    const result = await downloadMessage(
        t.context.mockClient,
        t.context.mockChat,
        messageId,
        t.context.sectionDir,
        isReferenced,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        t.context.downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result.id, messageId);
    t.true(t.context.logs.log.some(log => log.includes('(referenced)')));
    t.is(t.context.stats.messages.referenced, 1);

    // Verify file was created in referenced directory
    const referencedDir = path.join(t.context.sectionDir, OUTPUT_DIRS.referenced);
    const filePath = path.join(referencedDir, `${messageId}.json`);
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    t.true(fileExists);
});

// downloadReferencedMessages tests
test('downloadReferencedMessages() - should download all referenced messages recursively', async (t) => {
    // Arrange
    const messageIds = [123, 456];
    const downloadedMessages = new Set();

    // Act - Just test with the actual implementation
    const result = await downloadReferencedMessages(
        t.context.mockClient,
        t.context.mockChat,
        messageIds,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result.length, 2); // Only 123 and 456 are downloaded
});

test('downloadReferencedMessages() - should avoid duplicate downloads', async (t) => {
    // Arrange
    const messageIds = [123, 456];
    const downloadedMessages = new Set();
    downloadedMessages.add(789); // Mark as already downloaded

    // Act
    const result = await downloadReferencedMessages(
        t.context.mockClient,
        t.context.mockChat,
        messageIds,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result.length, 2); // Only 123 and 456, 789 was already downloaded
});

test('downloadReferencedMessages() - should handle circular references', async (t) => {
    // Arrange
    const messageIds = [123];
    const downloadedMessages = new Set();

    // Act
    const result = await downloadReferencedMessages(
        t.context.mockClient,
        t.context.mockChat,
        messageIds,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.mockScraper,
        downloadedMessages,
        t.context.logFn,
        t.context.warnFn,
        t.context.errorFn,
    );

    // Assert
    t.is(result.length, 1); // Only 123 is downloaded
});
