const test = require('ava');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
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
                pinned: 'data/registration.md',
                pinnedId: 747976,
            },
            {
                title: 'Rules',
                slug: 'rules',
                topicId: 8978,
                pinned: 'data/rules.md',
                pinnedId: 747977,
            },
            {
                title: 'FAQ',
                slug: 'faq',
                topicId: 8979,
                pinned: 'data/faq.md',
                // No pinnedId
            },
        ],
    });

    await fsPromises.writeFile(t.context.configPath, topicsYaml);

    // Create test markdown files
    await fsPromises.writeFile(
        path.join(dir.getData(), 'registration.md'),
        '# Registration\n\nThis is the registration content.',
    );
    await fsPromises.writeFile(
        path.join(dir.getData(), 'rules.md'),
        '# Rules\n\nThese are the community rules.',
    );
    await fsPromises.writeFile(
        path.join(dir.getData(), 'faq.md'),
        '# FAQ\n\nFrequently asked questions.',
    );

    // Create test image file
    await fsPromises.writeFile(
        path.join(dir.getData(), 'registration.png'),
        'fake-image-content',
    );

    // Create TopicsConfig instance with test directory
    t.context.topicsConfig = new TopicsConfig(dir.getRoot());
});

test('TopicsConfig.load() - should load topics configuration from file', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const config = await topicsConfig.load();

    // Assert
    t.is(typeof config, 'object');
    t.true(Array.isArray(config.topics));
    t.is(config.topics.length, 3);
    t.is(config.topics[0].title, 'Registration');
    t.is(config.topics[0].slug, 'registration');
    t.is(config.topics[0].topicId, 8977);
});

test('TopicsConfig.load() - should return cached config on subsequent calls', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const config1 = await topicsConfig.load();
    const config2 = await topicsConfig.load();

    // Assert
    t.is(config1, config2); // Should be the same object reference
});

test('TopicsConfig.load() - should throw error when config file is missing', async (t) => {
    // Arrange
    const topicsConfig = new TopicsConfig('/nonexistent/path');

    // Act & Assert
    await t.throwsAsync(async () => await topicsConfig.load(), {
        message: /Topics config not found/,
    });
});

test('TopicsConfig.load() - should throw error when config file is invalid YAML', async (t) => {
    // Arrange
    await fsPromises.writeFile(t.context.configPath, 'invalid: yaml: content: [');
    const topicsConfig = t.context.topicsConfig;
    topicsConfig.config = null; // Reset cache

    // Act & Assert
    await t.throwsAsync(async () => await topicsConfig.load(), {
        message: /Failed to load topics config/,
    });
});

test('TopicsConfig.save() - should save configuration to file', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const newConfig = {
        topics: [
            {
                title: 'New Topic',
                slug: 'new-topic',
                topicId: 9000,
                pinned: 'data/new.md',
                pinnedId: 8000,
            },
        ],
    };

    // Act
    await topicsConfig.save(newConfig);

    // Assert
    const savedContent = await fsPromises.readFile(t.context.configPath, 'utf8');
    const savedConfig = yaml.load(savedContent);
    t.deepEqual(savedConfig, newConfig);
    t.is(topicsConfig.config, newConfig); // Should update cache
});

test('TopicsConfig.save() - should throw error when file cannot be written', async (t) => {
    // Arrange
    const topicsConfig = new TopicsConfig('/nonexistent/path');
    const config = { topics: [] };

    // Act & Assert
    await t.throwsAsync(async () => await topicsConfig.save(config), {
        message: /Failed to save topics config/,
    });
});

test('TopicsConfig.getTopics() - should return all topics', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topics = await topicsConfig.getTopics();

    // Assert
    t.true(Array.isArray(topics));
    t.is(topics.length, 3);
    t.is(topics[0].slug, 'registration');
    t.is(topics[1].slug, 'rules');
    t.is(topics[2].slug, 'faq');
});

test('TopicsConfig.getTopics() - should return empty array when no topics', async (t) => {
    // Arrange
    const emptyConfig = { topics: [] };
    await t.context.topicsConfig.save(emptyConfig);
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topics = await topicsConfig.getTopics();

    // Assert
    t.true(Array.isArray(topics));
    t.is(topics.length, 0);
});

test('TopicsConfig.getTopicsWithPinned() - should return topics with both pinned and pinnedId', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topics = await topicsConfig.getTopicsWithPinned();

    // Assert
    t.true(Array.isArray(topics));
    t.is(topics.length, 2); // Only registration and rules have pinnedId
    t.is(topics[0].slug, 'registration');
    t.is(topics[1].slug, 'rules');
    t.is(topics[0].pinnedId, 747976);
    t.is(topics[1].pinnedId, 747977);
});

test('TopicsConfig.getTopicsWithPinned() - should return empty array when no topics have pinnedId', async (t) => {
    // Arrange
    const configWithoutPinnedId = {
        topics: [
            {
                title: 'Topic 1',
                slug: 'topic1',
                topicId: 1001,
                pinned: 'data/topic1.md',
                // No pinnedId
            },
            {
                title: 'Topic 2',
                slug: 'topic2',
                topicId: 1002,
                // No pinned or pinnedId
            },
        ],
    };
    await t.context.topicsConfig.save(configWithoutPinnedId);
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topics = await topicsConfig.getTopicsWithPinned();

    // Assert
    t.true(Array.isArray(topics));
    t.is(topics.length, 0);
});

test('TopicsConfig.getTopic() - should return topic by slug', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topic = await topicsConfig.getTopic('registration');

    // Assert
    t.is(typeof topic, 'object');
    t.is(topic.title, 'Registration');
    t.is(topic.slug, 'registration');
    t.is(topic.topicId, 8977);
    t.is(topic.pinned, 'data/registration.md');
    t.is(topic.pinnedId, 747976);
});

test('TopicsConfig.getTopic() - should return undefined for non-existent slug', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const topic = await topicsConfig.getTopic('nonexistent');

    // Assert
    t.is(topic, undefined);
});

test('TopicsConfig.updatePinnedId() - should update pinned message ID for topic', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const slug = 'registration';
    const newPinnedId = 999999;

    // Act
    const updatedTopic = await topicsConfig.updatePinnedId(slug, newPinnedId);

    // Assert
    t.is(updatedTopic.pinnedId, newPinnedId);

    // Verify the change was persisted
    const topic = await topicsConfig.getTopic(slug);
    t.is(topic.pinnedId, newPinnedId);
});

test('TopicsConfig.updatePinnedId() - should throw error for non-existent topic', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act & Assert
    await t.throwsAsync(async () => await topicsConfig.updatePinnedId('nonexistent', 12345), {
        message: /Topic with slug "nonexistent" not found/,
    });
});

test('TopicsConfig.readPinnedFile() - should read markdown file content', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const pinnedPath = 'data/registration.md';

    // Act
    const content = await topicsConfig.readPinnedFile(pinnedPath);

    // Assert
    t.is(typeof content, 'string');
    t.true(content.includes('# Registration'));
    t.true(content.includes('This is the registration content.'));
});

test('TopicsConfig.readPinnedFile() - should throw error for non-existent file', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act & Assert
    await t.throwsAsync(async () => await topicsConfig.readPinnedFile('data/nonexistent.md'), {
        message: /Failed to read pinned file/,
    });
});

test('TopicsConfig.getImagePath() - should return path when image file exists', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const pinnedPath = 'data/registration.md';

    // Act
    const imagePath = await topicsConfig.getImagePath(pinnedPath);

    // Assert
    t.is(imagePath, 'data/registration.png');
});

test('TopicsConfig.getImagePath() - should return null when no image file exists', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const pinnedPath = 'data/rules.md';

    // Act
    const imagePath = await topicsConfig.getImagePath(pinnedPath);

    // Assert
    t.is(imagePath, null);
});

test('TopicsConfig.getImagePath() - should check all image extensions', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    const pinnedPath = 'data/faq.md';

    // Create a JPEG image for FAQ
    await fsPromises.writeFile(
        path.join(t.context.dir.getData(), 'faq.jpeg'),
        'fake-jpeg-content',
    );

    // Act
    const imagePath = await topicsConfig.getImagePath(pinnedPath);

    // Assert
    t.is(imagePath, 'data/faq.jpeg');
});

test('TopicsConfig.getImagePath() - should return null for empty path', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const imagePath = await topicsConfig.getImagePath('');

    // Assert
    t.is(imagePath, null);
});

test('TopicsConfig - should handle custom base directory', async (t) => {
    // Arrange
    const customDir = new TestDir();
    const customConfigPath = path.join(customDir.getConfig(), 'topics.yml');

    const topicsYaml = yaml.dump({
        topics: [
            {
                title: 'Custom Topic',
                slug: 'custom',
                topicId: 9999,
                pinned: 'data/custom.md',
                pinnedId: 8888,
            },
        ],
    });

    await fsPromises.writeFile(customConfigPath, topicsYaml);
    await fsPromises.writeFile(
        path.join(customDir.getData(), 'custom.md'),
        '# Custom Topic\n\nCustom content.',
    );

    const topicsConfig = new TopicsConfig(customDir.getRoot());

    // Act
    const topics = await topicsConfig.getTopics();
    const content = await topicsConfig.readPinnedFile('data/custom.md');

    // Assert
    t.is(topics.length, 1);
    t.is(topics[0].slug, 'custom');
    t.true(content.includes('Custom content'));
});
