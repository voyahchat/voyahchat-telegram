const test = require('ava');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { TopicsConfig } = require('../lib/topics-config');
const { generateFaqContent, generateAndSaveFaq } = require('../lib/faq-generator');
const { TestDir } = require('./helpers/test-dir');

function createTestConfig(topics) {
    return { topics };
}

test.beforeEach(async (t) => {
    const dir = new TestDir();
    t.context.dir = dir;

    const config = createTestConfig([
        {
            title: 'Registration',
            slug: 'registration',
            topicId: 8977,
            pinned: 'data/pinned/registration.md',
            botPinnedId: 1413056,
        },
        { title: 'Charging', slug: 'charging', topicId: 11517, pinned: 'data/pinned/charging.md' },
        {
            title: 'Rules',
            slug: 'rules',
            topicId: 8978,
            pinned: 'data/pinned/rules.md',
            botPinnedId: 999,
        },
        {
            title: 'FAQ',
            slug: 'faq',
            topicId: 32898,
            pinned: 'data/pinned/faq.md',
            sections: [
                ['rules', 'registration'],
                ['charging'],
            ],
        },
    ]);

    const configPath = path.join(dir.getConfig(), 'topics.yml');
    await fsPromises.writeFile(configPath, yaml.dump(config));
    t.context.topicsConfig = new TopicsConfig(dir.getRoot());
});

// --- generateFaqContent tests ---

test('generateFaqContent() - should produce links with botPinnedId', (t) => {
    // Arrange
    const config = createTestConfig([
        { title: 'Rules', slug: 'rules', topicId: 8978, botPinnedId: 999 },
        { title: 'FAQ', slug: 'faq', topicId: 32898, sections: [['rules']] },
    ]);

    // Act
    const content = generateFaqContent(config);

    // Assert
    t.true(content.includes('Закрепы разделов'));
    t.true(content.includes('[Rules](https://t.me/voyahchat/8978/999)'));
});

test('generateFaqContent() - should link to topic root when no botPinnedId', (t) => {
    // Arrange
    const config = createTestConfig([
        { title: 'Charging', slug: 'charging', topicId: 11517 },
        { title: 'FAQ', slug: 'faq', topicId: 32898, sections: [['charging']] },
    ]);

    // Act
    const content = generateFaqContent(config);

    // Assert
    t.true(content.includes('[Charging](https://t.me/voyahchat/11517)'));
    t.false(content.includes('закреп'));
});

test('generateFaqContent() - should skip unknown slugs', (t) => {
    // Arrange
    const config = createTestConfig([
        {
            title: 'FAQ',
            slug: 'faq',
            topicId: 32898,
            sections: [['nonexistent', 'rules']],
            pinned: 'data/pinned/faq.md',
        },
        { title: 'Rules', slug: 'rules', topicId: 8978, botPinnedId: 100 },
    ]);

    // Act
    const content = generateFaqContent(config);

    // Assert
    t.false(content.includes('nonexistent'));
    t.true(content.includes('[Rules]'));
});

test('generateFaqContent() - should separate sections with blank lines', (t) => {
    // Arrange
    const config = createTestConfig([
        { title: 'Rules', slug: 'rules', topicId: 8978, botPinnedId: 100 },
        { title: 'Charging', slug: 'charging', topicId: 11517, botPinnedId: 200 },
        { title: 'FAQ', slug: 'faq', topicId: 32898, sections: [['rules'], ['charging']] },
    ]);

    // Act
    const content = generateFaqContent(config);

    // Assert
    const rulesLine = content.indexOf('[Rules]');
    const chargingLine = content.indexOf('[Charging]');
    t.true(chargingLine > rulesLine);
    // There should be a blank line between sections
    const between = content.substring(rulesLine, chargingLine);
    t.true(between.includes('\n\n'));
});

test('generateFaqContent() - should throw when no faq topic', (t) => {
    // Arrange
    const config = createTestConfig([
        { title: 'Rules', slug: 'rules', topicId: 8978 },
    ]);

    // Act & Assert
    t.throws(() => generateFaqContent(config), { message: /FAQ topic not found/ });
});

test('generateFaqContent() - should throw when faq has no sections', (t) => {
    // Arrange
    const config = createTestConfig([
        { title: 'FAQ', slug: 'faq', topicId: 32898 },
    ]);

    // Act & Assert
    t.throws(() => generateFaqContent(config), { message: /FAQ topic not found or has no sections/ });
});

// --- generateAndSaveFaq tests ---

test('generateAndSaveFaq() - should write content to faq.md', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;

    // Act
    const content = await generateAndSaveFaq(topicsConfig);

    // Assert
    const faqPath = path.join(t.context.dir.getRoot(), 'data', 'pinned', 'faq.md');
    const saved = await fsPromises.readFile(faqPath, 'utf8');
    t.is(saved, content);
    t.true(saved.includes('[Registration](https://t.me/voyahchat/8977/1413056)'));
    t.true(saved.includes('[Charging](https://t.me/voyahchat/11517)'));
});

test('generateAndSaveFaq() - should reflect updated botPinnedIds', async (t) => {
    // Arrange
    const topicsConfig = t.context.topicsConfig;
    await topicsConfig.updateBotPinnedId('charging', 555123);

    // Act
    const content = await generateAndSaveFaq(topicsConfig);

    // Assert
    t.true(content.includes('[Charging](https://t.me/voyahchat/11517/555123)'));
    t.true(content.includes('[Charging](https://t.me/voyahchat/11517/555123)'));
});

test('generateAndSaveFaq() - should throw when no faq topic in config', async (t) => {
    // Arrange
    const dir = new TestDir();
    const configPath = path.join(dir.getConfig(), 'topics.yml');
    await fsPromises.writeFile(configPath, yaml.dump({ topics: [] }));
    const topicsConfig = new TopicsConfig(dir.getRoot());

    // Act & Assert
    await t.throwsAsync(() => generateAndSaveFaq(topicsConfig), { message: /FAQ topic not found/ });
});
