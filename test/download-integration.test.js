const test = require('ava');
const fs = require('fs').promises;
const { TestDir } = require('./helpers/test-dir');
const TelegramDownloader = require('../lib/download');

test.beforeEach(async (t) => {
    // Create a temporary directory for each test
    t.context.testDir = new TestDir();
});


test('TelegramDownloader.constructor() - should initialize with default options', (t) => {
    // Arrange & Act
    const downloader = new TelegramDownloader();

    // Assert
    t.is(downloader.outputDir, 'downloaded');
    t.true(downloader.downloadedMessages instanceof Set);
    t.is(downloader.downloadedMessages.size, 0);
    t.is(typeof downloader.config, 'object');
    t.is(typeof downloader.stats, 'object');
    t.is(typeof downloader.logger, 'object');
    t.is(typeof downloader.scraper, 'object');
});

test('TelegramDownloader.constructor() - should initialize with custom options', (t) => {
    // Arrange
    const options = {
        outputDir: 'custom-output',
        verbose: true,
    };

    // Act
    const downloader = new TelegramDownloader(options);

    // Assert
    t.is(downloader.outputDir, 'custom-output');
    t.is(downloader.verbose, true);
});

test('TelegramDownloader.constructor() - should create output directory if it does not exist', async (t) => {
    // Arrange
    const outputDir = t.context.testDir.getDownloaded();
    new TelegramDownloader({ outputDir });

    // Act
    const stats = await fs.stat(outputDir);

    // Assert
    t.true(stats.isDirectory());
});

test('TelegramDownloader.messageToJson() - should handle messageToJson with basic message', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const message = {
        id: 123,
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'Test message',
        entities: [],
    };
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the getDownloadConfig method
    downloader.getDownloadConfig = async () => ({
        mediaDir: 'media',
        maxFileSize: 10 * 1024 * 1024,
    });

    // Act
    const result = await downloader.messageToJson(message, sectionDir);

    // Assert
    t.is(result.id, 123);
    t.is(result.text, 'Test message');
    t.deepEqual(result.entities, []);
    t.deepEqual(result.media, []);
    t.deepEqual(result.referencedMessages, []);
    t.is(result.rawHtml, 'Test message');
    t.deepEqual(result.externalUrls, []);
});

test('TelegramDownloader.messageToJson() - should handle messageToJson with entities', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const message = {
        id: 123,
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'Bold text',
        entities: [
            { className: 'MessageEntityBold', offset: 0, length: 9 },
        ],
    };
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the getDownloadConfig method
    downloader.getDownloadConfig = async () => ({
        mediaDir: 'media',
        maxFileSize: 10 * 1024 * 1024,
    });

    // Act
    const result = await downloader.messageToJson(message, sectionDir);

    // Assert
    t.is(result.id, 123);
    t.is(result.text, 'Bold text');
    t.is(result.rawHtml, '<strong>Bold text</strong>');
});

test('TelegramDownloader.messageToJson() - should handle messageToJson with URL entities', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const message = {
        id: 123,
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'Visit Google',
        entities: [
            { className: 'MessageEntityTextUrl', offset: 6, length: 6, url: 'https://google.com' },
        ],
    };
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the getDownloadConfig method
    downloader.getDownloadConfig = async () => ({
        mediaDir: 'media',
        maxFileSize: 10 * 1024 * 1024,
    });

    // Act & Assert
    // Just verify the function doesn't throw an error
    const result = await downloader.messageToJson(message, sectionDir);
    t.is(result.id, 123);
    t.is(result.text, 'Visit Google');
    t.is(typeof result.rawHtml, 'string');
});

test('TelegramDownloader.messageToJson() - should extract referenced messages from text', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const message = {
        id: 123,
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'See https://t.me/testchat/456 for details',
        entities: [],
    };
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the getDownloadConfig method
    downloader.getDownloadConfig = async () => ({
        mediaDir: 'media',
        maxFileSize: 10 * 1024 * 1024,
    });

    // Act
    const result = await downloader.messageToJson(message, sectionDir);

    // Assert
    t.deepEqual(result.referencedMessages, [456]);
});

test('TelegramDownloader.messageToJson() - should extract external URLs from text', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const message = {
        id: 123,
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'Visit https://example.com for more info',
        entities: [],
    };
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the getDownloadConfig method
    downloader.getDownloadConfig = async () => ({
        mediaDir: 'media',
        maxFileSize: 10 * 1024 * 1024,
    });

    // Act
    const result = await downloader.messageToJson(message, sectionDir);

    // Assert
    t.deepEqual(result.externalUrls, ['https://example.com']);
});

test('TelegramDownloader.downloadReferencedMessages() - should handle downloadReferencedMessages', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const chat = { id: 'test-chat' };
    const messageIds = [123, 456];
    const sectionDir = t.context.testDir.getDownloaded();

    // Mock the downloadMessage method
    let callCount = 0;
    downloader.downloadMessage = async (_chat, messageId, _sectionDir, _isReferenced) => {
        callCount++;
        return {
            id: messageId,
            text: `Message ${messageId}`,
            referencedMessages: messageId === 123 ? [789] : [],
        };
    };

    // Act
    const result = await downloader.downloadReferencedMessages(chat, messageIds, sectionDir);

    // Assert
    t.is(result.length, 3); // Should include the referenced message 789
    t.is(result[0].id, 123);
    t.is(result[1].id, 456);
    t.is(result[2].id, 789);
    // Should be called 3 times: 123, 456, and 789 (referenced by 123)
    t.is(callCount, 3);
});

test('TelegramDownloader.downloadSectionBySlug() - should handle downloadSectionBySlug', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const slug = 'test-section';
    const section = {
        slug: 'test-section',
        name: 'Test Section',
        pinnedMessageId: 123,
    };

    // Mock the config methods
    downloader.config = {
        getSection: async (sectionSlug) => {
            if (sectionSlug === 'test-section') {
                return section;
            }
            return null;
        },
    };

    // Mock the downloadSection method
    downloader.downloadSection = async (sectionData) => {
        return {
            slug: sectionData.slug,
            name: sectionData.name,
            downloadedAt: new Date().toISOString(),
        };
    };

    // Act
    const result = await downloader.downloadSectionBySlug(slug);

    // Assert
    t.is(result.slug, 'test-section');
    t.is(result.name, 'Test Section');
});

test('TelegramDownloader.downloadSectionBySlug() - should throw error for non-existent section', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const slug = 'non-existent-section';

    // Mock the config methods
    downloader.config = {
        getSection: async () => null,
    };

    // Act & Assert
    await t.throwsAsync(
        () => downloader.downloadSectionBySlug(slug),
        { message: `Section "${slug}" not found` },
    );
});

test('TelegramDownloader.downloadAdditionalMessages() - should handle with no messages', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();

    // Mock the config methods
    downloader.config = {
        getAdditionalMessages: async () => [],
    };

    // Act
    const result = await downloader.downloadAdditionalMessages();

    // Assert
    t.deepEqual(result, []);
});

test('TelegramDownloader.downloadAdditionalMessages() - should handle with messages', async (t) => {
    // Arrange
    const downloader = new TelegramDownloader();
    const messages = [
        { name: 'Test Message', slug: 'test-message', messageId: 123 },
    ];

    // Mock the config methods
    downloader.config = {
        getAdditionalMessages: async () => messages,
        getChat: async () => ({ id: 'test-chat' }),
    };

    // Mock the getChat method to avoid client connection issues
    downloader.getChat = async () => ({ id: 'test-chat' });

    // Mock the downloadMessage method
    downloader.downloadMessage = async (_chat, messageId, _sectionDir) => {
        return {
            id: messageId,
            text: `Message ${messageId}`,
            referencedMessages: [],
        };
    };

    // Act
    const result = await downloader.downloadAdditionalMessages();

    // Assert
    t.is(result.length, 1);
    t.is(result[0].name, 'Test Message');
    t.is(result[0].messageId, 123);
});
