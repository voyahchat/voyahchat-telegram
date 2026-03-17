const test = require('ava');
const path = require('path');
const fsPromises = require('fs').promises;
const yaml = require('js-yaml');
const { PinnedDownload } = require('../lib/pinned-download');
const { TopicsConfig } = require('../lib/topics-config');
const { TestDir } = require('./helpers/test-dir');

test.beforeEach(async (t) => {
    // Create test directory
    const dir = new TestDir();
    t.context.dir = dir;
    t.context.configPath = path.join(dir.getConfig(), 'topics.yml');

    // Create test topics config file
    const topicsYaml = yaml.dump({
        topics: [
            {
                title: 'Registration',
                slug: 'registration',
                topicId: 8977,
                pinnedId: 747976,
            },
            {
                title: 'Rules',
                slug: 'rules',
                topicId: 8978,
                pinnedId: 747977,
            },
            {
                title: 'FAQ',
                slug: 'faq',
                topicId: 8979,
                // No pinnedId
            },
        ],
    });

    await fsPromises.writeFile(t.context.configPath, topicsYaml);

    // Create auth.yml for TelegramConfig
    const authYaml = yaml.dump({
        api_id: 12345,
        api_hash: 'test_hash',
        phone: '+1234567890',
        session: 'test_session',
    });
    await fsPromises.writeFile(path.join(dir.getConfig(), 'auth.yml'), authYaml);

    // Create download.yml for TelegramConfig
    const downloadYaml = yaml.dump({
        settings: {
            connectionRetries: 5,
            retryDelayBaseMs: 1000,
            connectionTimeoutMs: 30000,
        },
        chat: {
            name: 'testchat',
        },
    });
    await fsPromises.writeFile(path.join(dir.getConfig(), 'download.yml'), downloadYaml);
});

test('PinnedDownload.constructor() - should initialize with default options', (t) => {
    // Arrange & Act
    const downloader = new PinnedDownload();

    // Assert
    t.is(downloader.verbose, false);
    t.is(downloader.dryRun, false);
    t.is(downloader.force, false);
    t.is(downloader.client, null);
});

test('PinnedDownload.constructor() - should accept options', (t) => {
    // Arrange & Act
    const downloader = new PinnedDownload({
        verbose: true,
        dryRun: true,
        force: true,
    });

    // Assert
    t.is(downloader.verbose, true);
    t.is(downloader.dryRun, true);
    t.is(downloader.force, true);
});

test('PinnedDownload - should skip existing files without force flag', async (t) => {
    // Arrange
    const dir = t.context.dir;

    // Create existing pinned file
    const pinnedDir = dir.getPinned();
    await fsPromises.writeFile(
        path.join(pinnedDir, 'registration.md'),
        'Existing content',
    );

    // Update topics.yml to include pinned path
    const topicsYaml = yaml.dump({
        topics: [
            {
                title: 'Registration',
                slug: 'registration',
                topicId: 8977,
                pinnedId: 747976,
                pinned: 'data/pinned/registration.md',
            },
        ],
    });
    await fsPromises.writeFile(t.context.configPath, topicsYaml);

    // Create mock client
    const mockClient = {
        getMessages: async () => [
            {
                id: 747976,
                message: 'New content from Telegram',
                entities: [],
                media: null,
                date: new Date(),
            },
        ],
        invoke: async () => ({ chats: [{ id: 123 }] }),
        disconnect: async () => {},
    };

    const downloader = new PinnedDownload({
        createClient: async () => mockClient,
    });
    downloader.topicsConfig = new TopicsConfig(dir.getRoot());

    // Act
    const result = await downloader.downloadTopic({
        title: 'Registration',
        slug: 'registration',
        topicId: 8977,
        pinnedId: 747976,
        pinned: 'data/pinned/registration.md',
    });

    // Assert
    t.is(result.action, 'skipped');

    // Verify file was not overwritten
    const content = await fsPromises.readFile(
        path.join(pinnedDir, 'registration.md'),
        'utf8',
    );
    t.is(content, 'Existing content');
});

test('PinnedDownload.printSummary() - should print correct summary', (t) => {
    // Arrange
    const downloader = new PinnedDownload();
    const results = [
        { slug: 'topic1', action: 'downloaded' },
        { slug: 'topic2', action: 'downloaded' },
        { slug: 'topic3', action: 'skipped' },
        { slug: 'topic4', action: 'failed', error: 'Test error' },
    ];

    // Act & Assert (no error thrown)
    t.notThrows(() => downloader.printSummary(results));
});
