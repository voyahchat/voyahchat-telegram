const test = require('ava');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const sinon = require('sinon');
const { TestDir } = require('./helpers/test-dir');

const { PinnedSync } = require('../lib/pinned');

test.beforeEach(async (t) => {
    // Create test directory structure
    const dir = new TestDir();
    t.context.dir = dir;

    // Create test config files
    const mainConfigPath = path.join(dir.getConfig(), 'main.yml');
    const downloadConfigPath = path.join(dir.getConfig(), 'download.yml');
    const authConfigPath = path.join(dir.getConfig(), 'auth.yml');
    const topicsConfigPath = path.join(dir.getConfig(), 'topics.yml');

    const mainYaml = yaml.dump({
        api_id: 123456,
        api_hash: 'test_hash',
    });

    const downloadYaml = yaml.dump({
        chat: {
            name: 'testchat',
            sections: [],
        },
        download: {
            connectionRetries: 3,
            retryDelayBaseMs: 1000,
            connectionTimeoutMs: 30000,
        },
    });

    const authYaml = yaml.dump({
        phone: '+1234567890',
        session: 'test_session_string',
    });

    const topicsYaml = yaml.dump({
        topics: [
            {
                slug: 'registration',
                title: 'Registration',
                topicId: 8977,
                pinned: 'data/pinned/registration.md',
                pinnedId: 123,
            },
            {
                slug: 'rules',
                title: 'Rules',
                topicId: 8978,
                pinned: 'data/pinned/rules.md',
                pinnedId: null,
            },
        ],
    });

    await fsPromises.writeFile(mainConfigPath, mainYaml);
    await fsPromises.writeFile(downloadConfigPath, downloadYaml);
    await fsPromises.writeFile(authConfigPath, authYaml);
    await fsPromises.writeFile(topicsConfigPath, topicsYaml);

    // Create test markdown files
    const registrationMd = '# Registration\n\nPlease register to join the group.';
    const rulesMd = '# Rules\n\n1. Be respectful\n2. No spam';

    await fsPromises.writeFile(path.join(dir.getPinned(), 'registration.md'), registrationMd);
    await fsPromises.writeFile(path.join(dir.getPinned(), 'rules.md'), rulesMd);

    // Create PinnedSync instance with test directory
    t.context.pinnedSync = new PinnedSync({
        verbose: false,
        dryRun: true, // Default to dry-run for tests
    });

    // Override base directory for all config classes
    t.context.pinnedSync.telegramConfig.baseDir = dir.getRoot();
    t.context.pinnedSync.topicsConfig.baseDir = dir.getRoot();

    // Create a sandbox for sinon to manage stubs
    t.context.sandbox = sinon.createSandbox();

    // Mock Telegram client
    t.context.mockClient = {
        start: t.context.sandbox.stub().resolves(),
        invoke: t.context.sandbox.stub(),
        getMessages: t.context.sandbox.stub(),
        editMessage: t.context.sandbox.stub(),
        sendMessage: t.context.sandbox.stub(),
        uploadFile: t.context.sandbox.stub(),
        disconnect: t.context.sandbox.stub(),
        session: {
            save: t.context.sandbox.stub().returns('mock_session_string'),
        },
    };
});

test.afterEach.always((t) => {
    // Restore all stubs
    if (t.context.sandbox) {
        t.context.sandbox.restore();
    }
});


test('PinnedSync.init() - should initialize Telegram client', async (t) => {
    const mockClient = {
        start: t.context.sandbox.stub().resolves(),
        session: {
            save: t.context.sandbox.stub().returns('mock_session_string'),
        },
    };

    const createClient = t.context.sandbox.stub().resolves(mockClient);

    const sync = new PinnedSync({
        verbose: false,
        dryRun: true,
        createClient: createClient,
    });

    // Override base directory for config classes
    sync.telegramConfig.baseDir = t.context.dir.getRoot();
    sync.topicsConfig.baseDir = t.context.dir.getRoot();

    await sync.init();

    t.true(createClient.calledOnce);
    t.is(sync.client, mockClient);
});

test('PinnedSync.init() - should handle authentication errors', async (t) => {
    const createClient = t.context.sandbox.stub().rejects(new Error('Authentication failed'));

    const sync = new PinnedSync({
        verbose: false,
        dryRun: true,
        createClient: createClient,
    });

    // Override base directory for config classes
    sync.telegramConfig.baseDir = t.context.dir.getRoot();
    sync.topicsConfig.baseDir = t.context.dir.getRoot();

    await t.throwsAsync(async () => await sync.init(), {
        message: 'Authentication failed',
    });
});

// Core functionality tests
test('PinnedSync.compareContent() - should return true for identical content', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = '# Test\n\nThis is a test.';

    const message = {
        message: '# Test\n\nThis is a test.',
        entities: [],
    };

    t.true(sync.compareContent(localContent, message));
});

test('PinnedSync.compareContent() - should return false for different text content', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = '# Test\n\nThis is a test.';

    const message = {
        message: '# Test\n\nThis is different.',
        entities: [],
    };

    t.false(sync.compareContent(localContent, message));
});

test('PinnedSync.compareContent() - should return false for different entities', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = '# Test\n\nThis is a **test**.';

    const message = {
        message: '# Test\n\nThis is a test.',
        entities: [],
    };

    t.false(sync.compareContent(localContent, message));
});

test('PinnedSync.compareContent() - should handle null/undefined message', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = '# Test\n\nThis is a test.';

    t.false(sync.compareContent(localContent, null));
    t.false(sync.compareContent(localContent, undefined));
    t.false(sync.compareContent(localContent, {}));
});

test('PinnedSync.editMessage() - should edit message in normal mode', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    const chat = { id: 123 };
    const messageId = 456;
    const content = '# Updated\n\nThis is updated.';
    const topicId = 8977;

    // Mock successful edit
    t.context.mockClient.editMessage.resolves({ id: messageId, message: content });

    const result = await sync.editMessage(chat, messageId, content, null, topicId);

    t.true(t.context.mockClient.editMessage.calledOnce);
    t.is(result.id, messageId);

    // Verify correct parameters were passed
    const callArgs = t.context.mockClient.editMessage.firstCall.args;
    t.is(callArgs[0], chat);
    t.is(callArgs[1].message, messageId);
    t.is(callArgs[1].text, '# Updated\n\nThis is updated.');
    t.true(Array.isArray(callArgs[1].formattingEntities));
    t.true(callArgs[1].noWebpage);  // Verify link preview is disabled
});

test('PinnedSync.editMessage() - should log in dry-run mode', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = true;

    const chat = { id: 123 };
    const messageId = 456;
    const content = '# Updated\n\nThis is updated.';
    const topicId = 8977;

    // Mock the logger.action method
    const loggerActionStub = t.context.sandbox.stub(sync.logger, 'action');

    const result = await sync.editMessage(chat, messageId, content, null, topicId);

    t.false(t.context.mockClient.editMessage.called);
    t.is(result.id, messageId);
    // Check that dry-run log was called
    t.true(loggerActionStub.called);
});

test('PinnedSync.editMessage() - should handle errors', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    const chat = { id: 123 };
    const messageId = 456;
    const content = '# Updated\n\nThis is updated.';

    // Mock failed edit
    t.context.mockClient.editMessage.rejects(new Error('Edit failed'));

    await t.throwsAsync(async () => await sync.editMessage(chat, messageId, content), {
        message: 'Edit failed',
    });
});

test('PinnedSync.publishMessage() - should publish message in normal mode', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    const chat = { id: 123 };
    const content = '# New\n\nThis is new.';
    const newMessageId = 789;
    const topicId = 8977;

    // Mock successful publish
    t.context.mockClient.sendMessage.resolves({ id: newMessageId, message: content });

    const result = await sync.publishMessage(chat, content, null, topicId);

    t.true(t.context.mockClient.sendMessage.calledOnce);
    t.is(result.id, newMessageId);

    // Verify correct parameters were passed
    const callArgs = t.context.mockClient.sendMessage.firstCall.args;
    t.is(callArgs[0], chat);
    t.is(callArgs[1].message, '# New\n\nThis is new.');
    t.is(callArgs[1].replyTo, topicId);
    t.true(Array.isArray(callArgs[1].formattingEntities));
    t.true(callArgs[1].noWebpage);  // Verify link preview is disabled
});

test('PinnedSync.publishMessage() - should log in dry-run mode', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = true;

    const chat = { id: 123 };
    const content = '# New\n\nThis is new.';
    const topicId = 8977;

    // Mock the logger.action method
    const loggerActionStub = t.context.sandbox.stub(sync.logger, 'action');

    const result = await sync.publishMessage(chat, content, null, topicId);

    t.false(t.context.mockClient.sendMessage.called);
    t.is(result.id, 0);
    // Check that dry-run log was called
    t.true(loggerActionStub.called);
});

test('PinnedSync.publishMessage() - should handle errors', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    const chat = { id: 123 };
    const content = '# New\n\nThis is new.';

    // Mock failed publish
    t.context.mockClient.sendMessage.rejects(new Error('Publish failed'));

    await t.throwsAsync(async () => await sync.publishMessage(chat, content), {
        message: 'Publish failed',
    });
});

test('PinnedSync.syncTopic() - should sync topic with existing message', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Registration\n\nPlease register to join the group.', entities: [] },
    ]);

    // Mock getImagePath to return null (no local image)
    const getImagePathStub = t.context.sandbox.stub(sync.topicsConfig, 'getImagePath');
    getImagePathStub.withArgs('data/pinned/registration.md').resolves(null);

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    // Verify getImagePath was called
    t.true(getImagePathStub.calledOnce);
    t.is(getImagePathStub.firstCall.args[0], 'data/pinned/registration.md');

    t.is(result.slug, 'registration');
    t.is(result.title, 'Registration');
    t.is(result.action, 'updated');
    t.is(result.messageId, 123);
});

test('PinnedSync.syncTopic() - should update topic when content differs', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message with different content
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Old Registration\n\nOld content.', entities: [] },
    ]);

    // Mock editMessage
    sync.editMessage = t.context.sandbox.stub().resolves({ id: 123 });

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    t.is(result.slug, 'registration');
    t.is(result.title, 'Registration');
    t.is(result.action, 'updated');
    t.is(result.messageId, 123);
    t.true(sync.editMessage.calledOnce);
});

test('PinnedSync.syncTopic() - should create new message when pinnedId is null', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock publishMessage
    sync.publishMessage = t.context.sandbox.stub().resolves({ id: 456 });

    // Mock updatePinnedId
    sync.topicsConfig.updatePinnedId = t.context.sandbox.stub().resolves();

    const topic = {
        slug: 'rules',
        title: 'Rules',
        topicId: 8978,
        pinned: 'data/pinned/rules.md',
        pinnedId: null,
    };

    const result = await sync.syncTopic(topic);

    t.is(result.slug, 'rules');
    t.is(result.title, 'Rules');
    t.is(result.action, 'created');
    t.is(result.messageId, 456);
    t.true(sync.publishMessage.calledOnce);
    t.true(sync.topicsConfig.updatePinnedId.calledOnceWith('rules', 456));
});

test('PinnedSync.syncTopic() - should recreate message when existing message not found', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return empty array (message not found)
    t.context.mockClient.getMessages.resolves([]);

    // Mock publishMessage
    sync.publishMessage = t.context.sandbox.stub().resolves({ id: 789 });

    // Mock updatePinnedId
    sync.topicsConfig.updatePinnedId = t.context.sandbox.stub().resolves();

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    t.is(result.slug, 'registration');
    t.is(result.title, 'Registration');
    t.is(result.action, 'recreated');
    t.is(result.messageId, 789);
    t.true(sync.publishMessage.calledOnce);
    t.true(sync.topicsConfig.updatePinnedId.calledOnceWith('registration', 789));
});

test('PinnedSync.syncAll() - should sync all topics when no topicSlugs provided', async (t) => {
    const sync = t.context.pinnedSync;

    // Mock getTopicsWithPinned to return the test topics
    t.context.sandbox.stub(sync.topicsConfig, 'getTopicsWithPinned').resolves([
        { slug: 'registration', title: 'Registration', pinned: 'data/pinned/registration.md', pinnedId: 123 },
        { slug: 'rules', title: 'Rules', pinned: 'data/pinned/rules.md', pinnedId: null },
    ]);

    // Mock syncTopic
    sync.syncTopic = t.context.sandbox.stub()
        .onFirstCall().resolves({ slug: 'registration', action: 'unchanged' })
        .onSecondCall().resolves({ slug: 'rules', action: 'created' });

    // Mock printSummary to avoid output
    t.context.sandbox.stub(sync, 'printSummary');

    const results = await sync.syncAll();

    t.is(results.length, 2);
    t.is(results[0].slug, 'registration');
    t.is(results[0].action, 'unchanged');
    t.is(results[1].slug, 'rules');
    t.is(results[1].action, 'created');
    t.true(sync.syncTopic.calledTwice);
});

test('PinnedSync.syncAll() - should sync specific topics when topicSlugs provided', async (t) => {
    const sync = t.context.pinnedSync;

    // Mock getTopic to return the test topic
    t.context.sandbox.stub(sync.topicsConfig, 'getTopic').resolves({
        slug: 'registration',
        title: 'Registration',
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    });

    // Mock syncTopic
    sync.syncTopic = t.context.sandbox.stub().resolves({ slug: 'registration', action: 'updated' });

    // Mock printSummary to avoid output
    t.context.sandbox.stub(sync, 'printSummary');

    const results = await sync.syncAll(['registration']);

    t.is(results.length, 1);
    t.is(results[0].slug, 'registration');
    t.is(results[0].action, 'updated');
    t.true(sync.syncTopic.calledOnce);
});

test('PinnedSync.syncAll() - should handle non-existent topic', async (t) => {
    const sync = t.context.pinnedSync;

    // Mock the logger.warn method
    const loggerWarnStub = t.context.sandbox.stub(sync.logger, 'warn');

    const results = await sync.syncAll(['nonexistent']);

    t.is(results.length, 0);
    t.true(loggerWarnStub.calledWith('Topic "nonexistent" not found in configuration'));
});

test('PinnedSync.syncAll() - should continue when one topic fails', async (t) => {
    const sync = t.context.pinnedSync;

    // Mock getTopicsWithPinned to return the test topics
    t.context.sandbox.stub(sync.topicsConfig, 'getTopicsWithPinned').resolves([
        { slug: 'registration', title: 'Registration', pinned: 'data/pinned/registration.md', pinnedId: 123 },
        { slug: 'rules', title: 'Rules', pinned: 'data/pinned/rules.md', pinnedId: null },
    ]);

    // Mock syncTopic to fail for first topic and succeed for second
    sync.syncTopic = t.context.sandbox.stub()
        .onFirstCall().rejects(new Error('Sync failed'))
        .onSecondCall().resolves({ slug: 'rules', action: 'created' });

    // Mock printSummary to avoid output
    t.context.sandbox.stub(sync, 'printSummary');

    const results = await sync.syncAll();

    t.is(results.length, 2);
    t.is(results[0].slug, 'registration');
    t.is(results[0].action, 'failed');
    t.is(results[0].error, 'Sync failed');
    t.is(results[1].slug, 'rules');
    t.is(results[1].action, 'created');
});




test('PinnedSync.syncTopic() - should handle topic with associated image', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'registration.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Registration\n\nPlease register to join the group.', entities: [] },
    ]);

    // Mock getImagePath to return image path
    sync.topicsConfig.getImagePath = t.context.sandbox.stub().resolves(imagePath);


    // Mock uploadFile
    t.context.mockClient.uploadFile.resolves({ id: 'uploaded-file-id' });

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    // Mock compareContent to return false to trigger edit
    sync.compareContent = t.context.sandbox.stub().returns(false);

    // Mock editMessage to check if it's called with the right parameters
    const editMessageStub = t.context.sandbox.stub(sync, 'editMessage').resolves({ id: 123 });

    await sync.syncTopic(topic);

    t.true(sync.topicsConfig.getImagePath.calledOnce);
    t.true(editMessageStub.calledOnce);
});

test('PinnedSync.syncTopic() - should pass topicId to editMessage', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message with different content
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Old Registration\n\nOld content.', entities: [] },
    ]);

    // Mock editMessage
    const editMessageStub = t.context.sandbox.stub(sync, 'editMessage').resolves({ id: 123 });

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    await sync.syncTopic(topic);

    t.true(editMessageStub.calledOnce);
    // Verify topicId was passed as 5th argument
    t.is(editMessageStub.firstCall.args[4], 8977);
});

test('PinnedSync.syncTopic() - should pass topicId to publishMessage', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock publishMessage
    const publishMessageStub = t.context.sandbox.stub(sync, 'publishMessage').resolves({ id: 456 });

    // Mock updatePinnedId
    sync.topicsConfig.updatePinnedId = t.context.sandbox.stub().resolves();

    const topic = {
        slug: 'rules',
        title: 'Rules',
        topicId: 8978,
        pinned: 'data/pinned/rules.md',
        pinnedId: null,
    };

    await sync.syncTopic(topic);

    t.true(publishMessageStub.calledOnce);
    // Verify topicId was passed as 4th argument
    t.is(publishMessageStub.firstCall.args[3], 8978);
});


test('PinnedSync.isMessageNotModifiedError() - should return true for MESSAGE_NOT_MODIFIED error', (t) => {
    const sync = t.context.pinnedSync;

    const err = new Error('400: MESSAGE_NOT_MODIFIED (caused by messages.EditMessage)');
    t.true(sync.isMessageNotModifiedError(err));
});

test('PinnedSync.isMessageNotModifiedError() - should return false for other errors', (t) => {
    const sync = t.context.pinnedSync;

    t.false(sync.isMessageNotModifiedError(new Error('Network error')));
    t.false(sync.isMessageNotModifiedError(new Error('FLOOD_WAIT_60')));
    t.false(sync.isMessageNotModifiedError(null));
    t.false(sync.isMessageNotModifiedError(undefined));
});

test('PinnedSync.syncTopic() - should mark as unchanged when editMessage throws MESSAGE_NOT_MODIFIED', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message with different content (to trigger edit)
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Old Registration\n\nOld content.', entities: [] },
    ]);

    // Mock editMessage to throw MESSAGE_NOT_MODIFIED error
    t.context.mockClient.editMessage.rejects(new Error('400: MESSAGE_NOT_MODIFIED (caused by messages.EditMessage)'));

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    t.is(result.slug, 'registration');
    t.is(result.action, 'unchanged');
    t.is(result.messageId, 123);
    // Should NOT call sendMessage (no recreation)
    t.false(t.context.mockClient.sendMessage.called);
});

test('PinnedSync.syncTopic() - should still recreate message for other edit errors', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message with different content
    t.context.mockClient.getMessages.resolves([
        { id: 123, message: '# Old Registration\n\nOld content.', entities: [] },
    ]);

    // Mock editMessage to throw a different error (not MESSAGE_NOT_MODIFIED)
    t.context.mockClient.editMessage.rejects(new Error('400: MESSAGE_ID_INVALID'));

    // Mock sendMessage for recreation
    t.context.mockClient.sendMessage.resolves({ id: 789 });

    // Mock updatePinnedId
    sync.topicsConfig.updatePinnedId = t.context.sandbox.stub().resolves();

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    t.is(result.slug, 'registration');
    t.is(result.action, 'recreated');
    t.is(result.messageId, 789);
    // Should call sendMessage for recreation
    t.true(t.context.mockClient.sendMessage.called);
});

test('PinnedSync.normalizeEntityType() - should map MessageEntityBold to bold', (t) => {
    const sync = t.context.pinnedSync;

    t.is(sync.normalizeEntityType('MessageEntityBold'), 'bold');
});

test('PinnedSync.normalizeEntityType() - should map MessageEntityTextUrl to text_link', (t) => {
    const sync = t.context.pinnedSync;

    t.is(sync.normalizeEntityType('MessageEntityTextUrl'), 'text_link');
});

test('PinnedSync.normalizeEntityType() - should map MessageEntityItalic to italic', (t) => {
    const sync = t.context.pinnedSync;

    t.is(sync.normalizeEntityType('MessageEntityItalic'), 'italic');
});

test('PinnedSync.normalizeEntityType() - should handle unknown types with fallback', (t) => {
    const sync = t.context.pinnedSync;

    // Unknown type should use fallback transformation
    t.is(sync.normalizeEntityType('MessageEntityCustom'), 'custom');
});

test('PinnedSync.normalizeEntityType() - should handle null/undefined', (t) => {
    const sync = t.context.pinnedSync;

    t.is(sync.normalizeEntityType(null), '');
    t.is(sync.normalizeEntityType(undefined), '');
    t.is(sync.normalizeEntityType(''), '');
});

test('PinnedSync.compareContent() - should return true when entities match with TextUrl type', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = 'Check out [this link](https://example.com) for more info.';

    // Simulate Telegram message with MessageEntityTextUrl
    const message = {
        message: 'Check out this link for more info.',
        entities: [
            {
                className: 'MessageEntityTextUrl',
                offset: 10,
                length: 9,
                url: 'https://example.com',
            },
        ],
    };

    t.true(sync.compareContent(localContent, message));
});

test('PinnedSync.compareContent() - should return true for bold entities with MessageEntityBold', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = 'This is **bold** text.';

    // Simulate Telegram message with MessageEntityBold
    const message = {
        message: 'This is bold text.',
        entities: [
            {
                className: 'MessageEntityBold',
                offset: 8,
                length: 4,
            },
        ],
    };

    t.true(sync.compareContent(localContent, message));
});

test('PinnedSync.compareContent() - should handle mixed entity types correctly', (t) => {
    const sync = t.context.pinnedSync;
    const localContent = '**Bold** and [link](https://example.com) here.';

    // Simulate Telegram message with mixed entities
    const message = {
        message: 'Bold and link here.',
        entities: [
            {
                className: 'MessageEntityBold',
                offset: 0,
                length: 4,
            },
            {
                className: 'MessageEntityTextUrl',
                offset: 9,
                length: 4,
                url: 'https://example.com',
            },
        ],
    };

    t.true(sync.compareContent(localContent, message));
});

test('PinnedSync.syncTopic() - should detect when local image is added', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'registration.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message WITHOUT image media (but might have web page preview)
    t.context.mockClient.getMessages.resolves([
        {
            id: 123,
            message: '# Registration\n\nPlease register to join the group.',
            entities: [],
            media: { className: 'MessageMediaWebPage' },  // Web page preview, not an image
        },
    ]);

    // Mock getImagePath to return image path (local has image)
    sync.topicsConfig.getImagePath = t.context.sandbox.stub().resolves('data/pinned/registration.png');

    // Mock editMessage
    const editMessageStub = t.context.sandbox.stub(sync, 'editMessage').resolves({ id: 123 });

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    // Should detect image was added and trigger update
    t.is(result.action, 'updated');
    t.true(editMessageStub.calledOnce);
});

test('PinnedSync.syncTopic() - should detect when local image is removed', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message WITH image media
    t.context.mockClient.getMessages.resolves([
        {
            id: 123,
            message: '# Registration\n\nPlease register to join the group.',
            entities: [],
            media: { className: 'MessageMediaPhoto' },  // Has image media in remote
        },
    ]);

    // Mock getImagePath to return null (local has no image)
    sync.topicsConfig.getImagePath = t.context.sandbox.stub().resolves(null);

    // Mock editMessage
    const editMessageStub = t.context.sandbox.stub(sync, 'editMessage').resolves({ id: 123 });

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    // Should detect image was removed and trigger update
    t.is(result.action, 'updated');
    t.true(editMessageStub.calledOnce);
});

test('PinnedSync.syncTopic() - should remain unchanged when both have no image', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message WITHOUT image media
    t.context.mockClient.getMessages.resolves([
        {
            id: 123,
            message: '# Registration\n\nPlease register to join the group.',
            entities: [],
            media: { className: 'MessageMediaWebPage' },  // Web page preview, not an image
        },
    ]);

    // Mock getImagePath to return null (local has no image)
    sync.topicsConfig.getImagePath = t.context.sandbox.stub().resolves(null);

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    // Should remain unchanged - both have no image
    t.is(result.action, 'unchanged');
});

test('PinnedSync.syncTopic() - should remain unchanged when both have image and text matches', async (t) => {
    const sync = t.context.pinnedSync;
    sync.client = t.context.mockClient;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'registration.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    // Mock getChat
    sync.getChat = t.context.sandbox.stub().resolves({ id: 123 });

    // Mock getMessages to return existing message WITH image media
    t.context.mockClient.getMessages.resolves([
        {
            id: 123,
            message: '# Registration\n\nPlease register to join the group.',
            entities: [],
            media: { className: 'MessageMediaPhoto' },  // Has image media
        },
    ]);

    // Mock getImagePath to return image path (local has image)
    sync.topicsConfig.getImagePath = t.context.sandbox.stub().resolves('data/pinned/registration.png');

    const topic = {
        slug: 'registration',
        title: 'Registration',
        topicId: 8977,
        pinned: 'data/pinned/registration.md',
        pinnedId: 123,
    };

    const result = await sync.syncTopic(topic);

    // Should remain unchanged - both have image and text matches
    t.is(result.action, 'unchanged');
});

test('PinnedSync.prepareImageForUpload() - should create CustomFile with correct parameters', async (t) => {
    const sync = t.context.pinnedSync;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'test-image.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    const relativePath = 'data/pinned/test-image.png';
    const customFile = await sync.prepareImageForUpload(relativePath);

    t.is(customFile.name, 'test-image.png');
    t.is(customFile.size, 18); // 'fake-image-content'.length
    t.true(customFile.path.endsWith('test-image.png'));
    t.true(path.isAbsolute(customFile.path));
});

test('PinnedSync.prepareImageForUpload() - should throw error for non-existent file', async (t) => {
    const sync = t.context.pinnedSync;

    await t.throwsAsync(
        async () => await sync.prepareImageForUpload('data/pinned/non-existent.png'),
        { code: 'ENOENT' },
    );
});

test('PinnedSync.editMessage() - should use CustomFile for image upload', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'test-image.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    const chat = { id: 123 };
    const messageId = 456;
    const content = '# Updated\n\nThis is updated.';
    const relativePath = 'data/pinned/test-image.png';

    // Mock uploadFile to capture the CustomFile argument
    t.context.mockClient.uploadFile.resolves({ id: 'uploaded-file-id' });
    t.context.mockClient.editMessage.resolves({ id: messageId, message: content });

    await sync.editMessage(chat, messageId, content, relativePath);

    // Verify uploadFile was called with CustomFile
    t.true(t.context.mockClient.uploadFile.calledOnce);
    const uploadArgs = t.context.mockClient.uploadFile.firstCall.args[0];
    t.is(uploadArgs.file.name, 'test-image.png');
    t.true(path.isAbsolute(uploadArgs.file.path));
});

test('PinnedSync.publishMessage() - should use CustomFile for image upload', async (t) => {
    const sync = t.context.pinnedSync;
    sync.dryRun = false;
    sync.client = t.context.mockClient;

    // Create test image file
    const imagePath = path.join(t.context.dir.getPinned(), 'test-image.png');
    await fsPromises.writeFile(imagePath, 'fake-image-content');

    const chat = { id: 123 };
    const content = '# New\n\nThis is new.';
    const relativePath = 'data/pinned/test-image.png';

    // Mock uploadFile to capture the CustomFile argument
    t.context.mockClient.uploadFile.resolves({ id: 'uploaded-file-id' });
    t.context.mockClient.sendMessage.resolves({ id: 789, message: content });

    await sync.publishMessage(chat, content, relativePath);

    // Verify uploadFile was called with CustomFile
    t.true(t.context.mockClient.uploadFile.calledOnce);
    const uploadArgs = t.context.mockClient.uploadFile.firstCall.args[0];
    t.is(uploadArgs.file.name, 'test-image.png');
    t.true(path.isAbsolute(uploadArgs.file.path));
});
