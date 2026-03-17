const test = require('ava');
const sinon = require('sinon');
const path = require('path');
const fsPromises = require('fs').promises;
const yaml = require('js-yaml');
const { BotSync, contentHash } = require('../lib/bot-sync');
const { TopicsConfig } = require('../lib/topics-config');
const { TestDir } = require('./helpers/test-dir');

// Helper: create a mock BotApi
function createMockBotApi() {
    return {
        getMe: sinon.stub().resolves({ id: 123, is_bot: true, username: 'test_bot' }),
        sendMessage: sinon.stub().resolves({ message_id: 1000 }),
        editMessageText: sinon.stub().resolves({ message_id: 500 }),
        sendPhoto: sinon.stub().resolves({ message_id: 1001 }),
        editMessageMedia: sinon.stub().resolves({ message_id: 500 }),
        pinChatMessage: sinon.stub().resolves(true),
        deleteMessage: sinon.stub().resolves(true),
    };
}

// Helper: set up test directory with topics config and pinned files
async function setupTestDir(t) {
    const dir = new TestDir();
    t.context.dir = dir;

    // Create topics config
    const topicsYaml = yaml.dump({
        topics: [
            {
                title: 'Registration',
                slug: 'registration',
                topicId: 8977,
                pinnedId: 747976,
                pinned: 'data/pinned/registration.md',
            },
            {
                title: 'Charging',
                slug: 'charging',
                topicId: 11517,
                pinnedId: 747980,
                botPinnedId: 500,
                contentHash: 'old-hash',
                pinned: 'data/pinned/charging.md',
            },
            {
                title: 'Dreamer',
                slug: 'dreamer',
                topicId: 44496,
                pinnedId: 138607,
                // No pinned file — should be skipped
            },
        ],
    });

    await fsPromises.writeFile(path.join(dir.getConfig(), 'topics.yml'), topicsYaml);

    // Create pinned markdown files
    const pinnedDir = dir.getPinned();
    await fsPromises.writeFile(
        path.join(pinnedDir, 'registration.md'),
        '**Постановка на учёт**\n\n[ссылка](https://example.com)',
    );
    await fsPromises.writeFile(
        path.join(pinnedDir, 'charging.md'),
        '**Зарядка и батарея**\n\n[ссылка](https://example.com)',
    );

    // Create image file for charging topic
    await fsPromises.writeFile(
        path.join(pinnedDir, 'charging.jpg'),
        'fake-image-content',
    );

    const topicsConfig = new TopicsConfig(dir.getRoot());
    t.context.topicsConfig = topicsConfig;
    return topicsConfig;
}

test.afterEach(() => {
    sinon.restore();
});

// --- contentHash tests ---

test('contentHash - should return consistent SHA-256 hash', (t) => {
    const hash1 = contentHash('hello');
    const hash2 = contentHash('hello');
    t.is(hash1, hash2);
    t.is(hash1.length, 64); // SHA-256 hex is 64 chars
});

test('contentHash - different content should produce different hashes', (t) => {
    const hash1 = contentHash('hello');
    const hash2 = contentHash('world');
    t.not(hash1, hash2);
});

// --- Constructor tests ---

test('BotSync constructor - should throw without chatId', (t) => {
    // Temporarily clear env
    const orig = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_CHAT_ID;

    t.throws(() => new BotSync({
        botApi: createMockBotApi(),
    }), { message: /Chat ID is required/ });

    process.env.TELEGRAM_CHAT_ID = orig;
});

test('BotSync constructor - should throw without token and botApi', (t) => {
    const orig = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    t.throws(() => new BotSync({
        chatId: '-100123',
    }), { message: /Bot token is required/ });

    process.env.TELEGRAM_BOT_TOKEN = orig;
});

test('BotSync constructor - should accept injected dependencies', (t) => {
    const sync = new BotSync({
        chatId: '-100123',
        botApi: createMockBotApi(),
    });
    t.truthy(sync);
});

// --- verifyBot tests ---

test('BotSync.verifyBot() - should call getMe', async (t) => {
    const mockApi = createMockBotApi();
    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
    });

    const result = await sync.verifyBot();
    t.is(result.username, 'test_bot');
    t.is(mockApi.getMe.callCount, 1);
});

// --- syncTopic tests ---

test('BotSync.syncTopic() - should create new message when no botPinnedId', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('registration');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'created');
    t.is(result.messageId, 1000);
    t.is(mockApi.sendMessage.callCount, 1);
    t.is(mockApi.pinChatMessage.callCount, 1);

    // Verify sendMessage was called with correct params
    const sendArgs = mockApi.sendMessage.firstCall.args[0];
    t.is(sendArgs.chatId, '-100123');
    t.is(sendArgs.messageThreadId, 8977);
    t.true(sendArgs.text.includes('Постановка на учёт'));
});

test('BotSync.syncTopic() - should skip when hash matches', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    // Mock editMessageMedia to throw "message is not modified" error
    const notModifiedErr = new Error('not modified');
    notModifiedErr.description = 'Bad Request: message is not modified';
    mockApi.editMessageMedia.rejects(notModifiedErr);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    // Pre-compute the correct hash (including image content)
    const content = await topicsConfig.readPinnedFile('data/pinned/charging.md');
    const imagePath = await topicsConfig.getImagePath('data/pinned/charging.md');
    const absoluteImagePath = path.resolve(topicsConfig.baseDir, imagePath);
    const imageBuffer = await fsPromises.readFile(absoluteImagePath);
    const hash = contentHash(content + '::image::' + imageBuffer.toString('base64'));

    // Update topic with correct hash
    const config = await topicsConfig.load();
    const topic = config.topics.find(t => t.slug === 'charging');
    topic.contentHash = hash;
    await topicsConfig.save(config);

    // Reload and sync
    topicsConfig.config = null;
    const freshTopic = await topicsConfig.getTopic('charging');
    const result = await sync.syncTopic(freshTopic);

    t.is(result.action, 'unchanged');
    t.is(mockApi.sendMessage.callCount, 0);
    t.is(mockApi.editMessageText.callCount, 0);
    t.is(mockApi.editMessageMedia.callCount, 1); // Should call API to verify
});

test('BotSync.syncTopic() - should edit when hash differs', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('charging');
    // topic has botPinnedId=500 and contentHash='old-hash' which won't match
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'updated');
    t.is(result.messageId, 500);
    t.is(mockApi.editMessageMedia.callCount, 1);

    const editArgs = mockApi.editMessageMedia.firstCall.args[0];
    t.is(editArgs.chatId, '-100123');
    t.is(editArgs.messageId, 500);
});

test('BotSync.syncTopic() - dry-run should not call API', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
        dryRun: true,
    });

    const topic = await topicsConfig.getTopic('registration');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'created');
    t.is(mockApi.sendMessage.callCount, 0);
    t.is(mockApi.pinChatMessage.callCount, 0);
});

test('BotSync.syncTopic() - should handle message not found by recreating', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    // editMessageMedia throws "message not found"
    const notFoundErr = new Error('not found');
    notFoundErr.description = 'Bad Request: message to edit not found';
    mockApi.editMessageMedia.rejects(notFoundErr);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('charging');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'recreated');
    t.is(result.messageId, 1001); // New ID from sendPhoto, NOT old 500
    t.is(mockApi.editMessageMedia.callCount, 1);
    t.is(mockApi.sendPhoto.callCount, 1); // Fallback to publish
    t.is(mockApi.pinChatMessage.callCount, 1);

    // Verify that config was updated with the NEW message ID
    const updatedTopic = await topicsConfig.getTopic('charging');
    t.is(updatedTopic.botPinnedId, 1001); // New ID, not old 500
});

test('BotSync.syncTopic() - should handle MESSAGE_NOT_MODIFIED', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const notModifiedErr = new Error('not modified');
    notModifiedErr.description = 'Bad Request: message is not modified';
    mockApi.editMessageMedia.rejects(notModifiedErr);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('charging');
    const result = await sync.syncTopic(topic);

    // Should be marked as unchanged, not failed
    t.is(result.action, 'unchanged');
});

test('BotSync.syncTopic() - should recreate message when hash matches but message was deleted', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    // Pre-compute the correct hash (including image content)
    const content = await topicsConfig.readPinnedFile('data/pinned/charging.md');
    const imagePath = await topicsConfig.getImagePath('data/pinned/charging.md');
    const absoluteImagePath = path.resolve(topicsConfig.baseDir, imagePath);
    const imageBuffer = await fsPromises.readFile(absoluteImagePath);
    const hash = contentHash(content + '::image::' + imageBuffer.toString('base64'));

    // Update topic with correct hash
    const config = await topicsConfig.load();
    const topic = config.topics.find(t => t.slug === 'charging');
    topic.contentHash = hash;
    await topicsConfig.save(config);

    // Reload and sync
    topicsConfig.config = null;
    const freshTopic = await topicsConfig.getTopic('charging');

    // Mock editMessageMedia to throw "message not found" error
    const notFoundErr = new Error('not found');
    notFoundErr.description = 'Bad Request: message to edit not found';
    mockApi.editMessageMedia.rejects(notFoundErr);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const result = await sync.syncTopic(freshTopic);

    t.is(result.action, 'recreated');
    t.is(result.messageId, 1001); // New ID from sendPhoto
    t.is(mockApi.editMessageMedia.callCount, 1);
    t.is(mockApi.sendPhoto.callCount, 1); // Fallback to publish
    t.is(mockApi.pinChatMessage.callCount, 1);

    // Verify that config was updated with the NEW message ID
    const updatedTopic = await topicsConfig.getTopic('charging');
    t.is(updatedTopic.botPinnedId, 1001); // New ID, not old 500
});

test('BotSync.syncTopic() - should return unchanged when hash matches AND message exists', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    // Pre-compute the correct hash (including image content)
    const content = await topicsConfig.readPinnedFile('data/pinned/charging.md');
    const imagePath = await topicsConfig.getImagePath('data/pinned/charging.md');
    const absoluteImagePath = path.resolve(topicsConfig.baseDir, imagePath);
    const imageBuffer = await fsPromises.readFile(absoluteImagePath);
    const hash = contentHash(content + '::image::' + imageBuffer.toString('base64'));

    // Update topic with correct hash
    const config = await topicsConfig.load();
    const topic = config.topics.find(t => t.slug === 'charging');
    topic.contentHash = hash;
    await topicsConfig.save(config);

    // Reload and sync
    topicsConfig.config = null;
    const freshTopic = await topicsConfig.getTopic('charging');

    // Mock editMessageMedia to throw "message is not modified" error
    const notModifiedErr = new Error('not modified');
    notModifiedErr.description = 'Bad Request: message is not modified';
    mockApi.editMessageMedia.rejects(notModifiedErr);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const result = await sync.syncTopic(freshTopic);

    t.is(result.action, 'unchanged');
    t.is(mockApi.editMessageMedia.callCount, 1);
    t.is(mockApi.sendPhoto.callCount, 0); // Should NOT recreate
    t.is(mockApi.pinChatMessage.callCount, 0); // Should NOT pin

    // Verify that config was NOT updated (no changes)
    const updatedTopic = await topicsConfig.getTopic('charging');
    t.is(updatedTopic.botPinnedId, 500); // Still old ID
});

test('BotSync.syncTopic() - should update message when hash differs', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('charging');
    // topic has botPinnedId=500 and contentHash='old-hash' which won't match
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'updated');
    t.is(result.messageId, 500);
    t.is(mockApi.editMessageMedia.callCount, 1);

    const editArgs = mockApi.editMessageMedia.firstCall.args[0];
    t.is(editArgs.chatId, '-100123');
    t.is(editArgs.messageId, 500);
});

test('BotSync.syncTopic() - should return failed on unexpected error', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    mockApi.editMessageMedia.rejects(new Error('Unexpected server error'));

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('charging');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'failed');
    t.true(result.error.includes('Unexpected server error'));
});

// --- Image-related tests ---

test('BotSync.syncTopic() - should use sendPhoto when image exists for new message', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    // Add a topic without botPinnedId but with image
    const config = await topicsConfig.load();
    config.topics.push({
        title: 'With Image',
        slug: 'with-image',
        topicId: 9999,
        pinned: 'data/pinned/charging.md',  // Has charging.jpg
    });
    await topicsConfig.save(config);
    topicsConfig.config = null;

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('with-image');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'created');
    t.is(result.messageId, 1001); // sendPhoto returns message_id: 1001
    t.is(mockApi.sendPhoto.callCount, 1);
    t.is(mockApi.sendMessage.callCount, 0); // NOT sendMessage

    const photoArgs = mockApi.sendPhoto.firstCall.args[0];
    t.is(photoArgs.chatId, '-100123');
    t.is(photoArgs.messageThreadId, 9999);
    t.truthy(photoArgs.photoPath);
    t.truthy(photoArgs.caption);
});

test('BotSync.syncTopic() - should use editMessageMedia when image exists for edit', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    // charging topic has botPinnedId=500 and old-hash, AND has charging.jpg
    const topic = await topicsConfig.getTopic('charging');
    const result = await sync.syncTopic(topic);

    t.is(result.action, 'updated');
    t.is(mockApi.editMessageMedia.callCount, 1);
    t.is(mockApi.editMessageText.callCount, 0); // NOT editMessageText

    const mediaArgs = mockApi.editMessageMedia.firstCall.args[0];
    t.is(mediaArgs.chatId, '-100123');
    t.is(mediaArgs.messageId, 500);
    t.truthy(mediaArgs.photoPath);
    t.truthy(mediaArgs.caption);
});

test('BotSync.syncTopic() - image content change should trigger update', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    // First sync — creates hash with image content
    const topic1 = await topicsConfig.getTopic('charging');
    await sync.syncTopic(topic1);

    // Reset mocks
    mockApi.editMessageMedia.resetHistory();
    mockApi.editMessageText.resetHistory();

    // Change image content (same path, different content)
    const pinnedDir = t.context.dir.getPinned();
    await fsPromises.writeFile(
        path.join(pinnedDir, 'charging.jpg'),
        'DIFFERENT-image-content',
    );

    // Reload config to get updated hash
    topicsConfig.config = null;
    const topic2 = await topicsConfig.getTopic('charging');

    // Second sync — should detect image change
    const result = await sync.syncTopic(topic2);

    t.is(result.action, 'updated');
    t.is(mockApi.editMessageMedia.callCount, 1);
});

// --- syncAll tests ---

test('BotSync.syncAll() - should sync all topics with pinned files', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const results = await sync.syncAll();

    // registration (no botPinnedId → created) + charging (has botPinnedId → updated)
    // dreamer has no pinned file → skipped
    t.is(results.length, 2);
    t.is(results[0].slug, 'registration');
    t.is(results[1].slug, 'charging');
});

test('BotSync.syncAll() - should sync specific topics', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const results = await sync.syncAll(['registration']);

    t.is(results.length, 1);
    t.is(results[0].slug, 'registration');
});

test('BotSync.syncAll() - should warn for non-existent slug', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const results = await sync.syncAll(['nonexistent']);
    t.is(results.length, 0);
});

// --- Pin service message deletion tests ---

test('BotSync._publishNew() should call deleteMessage after pinning', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();
    mockApi.deleteMessage = sinon.stub().resolves(true);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('registration');
    await sync.syncTopic(topic);

    // Verify deleteMessage was called with messageId + 1
    t.is(mockApi.deleteMessage.callCount, 1);
    const deleteArgs = mockApi.deleteMessage.firstCall.args[0];
    t.is(deleteArgs.chatId, '-100123');
    t.is(deleteArgs.messageId, 1001); // sendMessage returns 1000, so delete 1001
});

test('BotSync._publishNew() should not fail if deleteMessage fails', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();
    mockApi.deleteMessage = sinon.stub().rejects(new Error('Message not found'));

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('registration');
    const result = await sync.syncTopic(topic);

    // Sync should still succeed even if deleteMessage fails
    t.is(result.action, 'created');
    t.is(result.messageId, 1000);
    t.is(mockApi.sendMessage.callCount, 1);
    t.is(mockApi.pinChatMessage.callCount, 1);
    t.is(mockApi.deleteMessage.callCount, 1);
});

test('BotSync._publishNew() should pass disable_notification to pinChatMessage', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();
    mockApi.deleteMessage = sinon.stub().resolves(true);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('registration');
    await sync.syncTopic(topic);

    // Verify pinChatMessage was called with disable_notification: true
    t.is(mockApi.pinChatMessage.callCount, 1);
    const pinArgs = mockApi.pinChatMessage.firstCall.args[0];
    t.is(pinArgs.chatId, '-100123');
    t.is(pinArgs.messageId, 1000);
    t.is(pinArgs.disableNotification, true);
});

// --- HTML parse_mode tests ---

test('BotSync.syncTopic() should use parse_mode HTML for sendMessage', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();
    mockApi.deleteMessage = sinon.stub().resolves(true);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    const topic = await topicsConfig.getTopic('registration');
    await sync.syncTopic(topic);

    // Verify sendMessage was called with parse_mode: 'HTML'
    t.is(mockApi.sendMessage.callCount, 1);
    const sendArgs = mockApi.sendMessage.firstCall.args[0];
    t.is(sendArgs.parseMode, 'HTML');
    t.true(sendArgs.text.includes('<b>'));
    t.true(sendArgs.text.includes('</b>'));
    // Should NOT have entities array when using HTML
    t.is(sendArgs.entities, undefined);
});

test('BotSync.syncTopic() should use parse_mode HTML for sendPhoto caption', async (t) => {
    const topicsConfig = await setupTestDir(t);
    const mockApi = createMockBotApi();
    mockApi.deleteMessage = sinon.stub().resolves(true);

    const sync = new BotSync({
        chatId: '-100123',
        botApi: mockApi,
        topicsConfig,
    });

    // Add a topic without botPinnedId but with image
    const config = await topicsConfig.load();
    config.topics.push({
        title: 'With Image',
        slug: 'with-image',
        topicId: 9999,
        pinned: 'data/pinned/charging.md',
    });
    await topicsConfig.save(config);
    topicsConfig.config = null;

    const topic = await topicsConfig.getTopic('with-image');
    await sync.syncTopic(topic);

    // Verify sendPhoto was called with parse_mode: 'HTML'
    t.is(mockApi.sendPhoto.callCount, 1);
    const photoArgs = mockApi.sendPhoto.firstCall.args[0];
    t.is(photoArgs.parseMode, 'HTML');
    t.true(photoArgs.caption.includes('<b>'));
    t.true(photoArgs.caption.includes('</b>'));
    // Should NOT have entities array when using HTML
    t.is(photoArgs.entities, undefined);
});
