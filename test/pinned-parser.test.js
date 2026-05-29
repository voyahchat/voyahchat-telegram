const test = require('ava');
const fs = require('fs');
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const {
    parsePinnedFile,
    parsePinnedContent,
    extractLinks,
    classifyLink,
    parseTelegramUrl,
} = require('../lib/pinned-parser');

// Tests for parsePinnedContent
test('parsePinnedContent() - should return empty result for null content', (t) => {
    // Arrange
    const content = null;

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.title, '');
    t.is(result.updatedAt, null);
    t.deepEqual(result.links, []);
});

test('parsePinnedContent() - should return empty result for empty content', (t) => {
    // Arrange
    const content = '';

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.title, '');
    t.is(result.updatedAt, null);
    t.deepEqual(result.links, []);
});

test('parsePinnedContent() - should extract title from first line', (t) => {
    // Arrange
    const content = '**Обсуждения прошивок машины** *(обновлено 27.01.2026)*';

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.title, 'Обсуждения прошивок машины');
});

test('parsePinnedContent() - should extract update date from first line', (t) => {
    // Arrange
    const content = '**Обсуждения прошивок машины** *(обновлено 27.01.2026)*';

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.updatedAt, '27.01.2026');
});

test('parsePinnedContent() - should extract links from content', (t) => {
    // Arrange
    const content = `**Title**

[voyahchat.ru/help](https://voyahchat.ru/help)
[t.me/voyahchat/11800/975515](https://t.me/voyahchat/11800/975515)`;

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.links.length, 2);
    t.is(result.links[0].text, 'voyahchat.ru/help');
    t.is(result.links[0].url, 'https://voyahchat.ru/help');
    t.is(result.links[1].text, 't.me/voyahchat/11800/975515');
    t.is(result.links[1].url, 'https://t.me/voyahchat/11800/975515');
});

test('parsePinnedContent() - should handle content without title', (t) => {
    // Arrange
    const content = 'Some text without bold title\n[link](https://example.com)';

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.title, '');
    t.is(result.links.length, 1);
});

test('parsePinnedContent() - should handle content without date', (t) => {
    // Arrange
    const content = '**Title without date**\n[link](https://example.com)';

    // Act
    const result = parsePinnedContent(content);

    // Assert
    t.is(result.title, 'Title without date');
    t.is(result.updatedAt, null);
});

// Tests for extractLinks
test('extractLinks() - should return empty array for null content', (t) => {
    // Arrange
    const content = null;

    // Act
    const result = extractLinks(content);

    // Assert
    t.deepEqual(result, []);
});

test('extractLinks() - should return empty array for empty content', (t) => {
    // Arrange
    const content = '';

    // Act
    const result = extractLinks(content);

    // Assert
    t.deepEqual(result, []);
});

test('extractLinks() - should extract single link', (t) => {
    // Arrange
    const content = 'Visit [Google](https://google.com) for search';

    // Act
    const result = extractLinks(content);

    // Assert
    t.is(result.length, 1);
    t.is(result[0].text, 'Google');
    t.is(result[0].url, 'https://google.com');
});

test('extractLinks() - should extract multiple links', (t) => {
    // Arrange
    const content = '[Link1](https://example1.com)\n[Link2](https://example2.com)';

    // Act
    const result = extractLinks(content);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].text, 'Link1');
    t.is(result[0].url, 'https://example1.com');
    t.is(result[1].text, 'Link2');
    t.is(result[1].url, 'https://example2.com');
});

test('extractLinks() - should classify telegram-message links', (t) => {
    // Arrange
    const content = '[Message](https://t.me/voyahchat/11800/975515)';

    // Act
    const result = extractLinks(content);

    // Assert
    t.is(result.length, 1);
    t.is(result[0].type, 'telegram-message');
    t.is(result[0].topicId, 11800);
    t.is(result[0].messageId, 975515);
});

test('extractLinks() - should classify site-page links', (t) => {
    // Arrange
    const content = '[Help](https://voyahchat.ru/help)';

    // Act
    const result = extractLinks(content);

    // Assert
    t.is(result.length, 1);
    t.is(result[0].type, 'site-page');
    t.is(result[0].sitePath, 'help');
});

test('extractLinks() - should classify external-link links', (t) => {
    // Arrange
    const content = '[External](https://example.com)';

    // Act
    const result = extractLinks(content);

    // Assert
    t.is(result.length, 1);
    t.is(result[0].type, 'external-link');
});

// Tests for classifyLink
test('classifyLink() - should return unknown for null url', (t) => {
    // Arrange
    const url = null;

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'unknown');
});

test('classifyLink() - should return unknown for empty url', (t) => {
    // Arrange
    const url = '';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'unknown');
});

test('classifyLink() - should classify Telegram message URL', (t) => {
    // Arrange
    const url = 'https://t.me/voyahchat/11800/975515';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'telegram-message');
    t.is(result.topicId, 11800);
    t.is(result.messageId, 975515);
});

test('classifyLink() - should classify Telegram message URL without https', (t) => {
    // Arrange
    const url = 't.me/voyahchat/558068/988963';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'telegram-message');
    t.is(result.topicId, 558068);
    t.is(result.messageId, 988963);
});

test('classifyLink() - should classify site page URL', (t) => {
    // Arrange
    const url = 'https://voyahchat.ru/help';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'site-page');
    t.is(result.sitePath, 'help');
});

test('classifyLink() - should classify site page URL with path', (t) => {
    // Arrange
    const url = 'https://voyahchat.ru/help/firmware';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'site-page');
    t.is(result.sitePath, 'help/firmware');
});

test('classifyLink() - should classify site page URL with hash', (t) => {
    // Arrange
    const url = 'https://voyahchat.ru/common/firmware/update#установка';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'site-page');
    t.is(result.sitePath, 'common/firmware/update#установка');
});

test('classifyLink() - should classify external link', (t) => {
    // Arrange
    const url = 'https://example.com';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'external-link');
});

test('classifyLink() - should classify Yandex Disk as external link', (t) => {
    // Arrange
    const url = 'https://disk.yandex.ru/d/0SZmiXV_meXrrA';

    // Act
    const result = classifyLink(url);

    // Assert
    t.is(result.type, 'external-link');
});

// Tests for parseTelegramUrl
test('parseTelegramUrl() - should return null for null url', (t) => {
    // Arrange
    const url = null;

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result, null);
});

test('parseTelegramUrl() - should return null for empty url', (t) => {
    // Arrange
    const url = '';

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result, null);
});

test('parseTelegramUrl() - should return null for non-Telegram url', (t) => {
    // Arrange
    const url = 'https://example.com';

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result, null);
});

test('parseTelegramUrl() - should parse Telegram URL', (t) => {
    // Arrange
    const url = 'https://t.me/voyahchat/11800/975515';

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result.topicId, 11800);
    t.is(result.messageId, 975515);
});

test('parseTelegramUrl() - should parse Telegram URL without https', (t) => {
    // Arrange
    const url = 't.me/voyahchat/177128/286863';

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result.topicId, 177128);
    t.is(result.messageId, 286863);
});

test('parseTelegramUrl() - should parse Telegram URL with query params', (t) => {
    // Arrange
    const url = 'https://t.me/voyahchat/11800/157828?single';

    // Act
    const result = parseTelegramUrl(url);

    // Assert
    t.is(result.topicId, 11800);
    t.is(result.messageId, 157828);
});

// Tests for parsePinnedFile
test('parsePinnedFile() - should parse real pinned file', (t) => {
    // Arrange
    const dir = new TestDir();
    const pinnedDir = dir.getPinned();
    const filePath = path.join(pinnedDir, 'test.md');

    const content = `**Обсуждения прошивок машины** *(обновлено 27.01.2026)*

**Платные услуги чата**
[voyahchat.ru/help](https://voyahchat.ru/help)

**Актуальные версии прошивок**
[voyahchat.ru/free/firmware](https://voyahchat.ru/free/firmware)

**Обновление на 6.6.1**
[t.me/voyahchat/11800/975515](https://t.me/voyahchat/11800/975515)`;

    fs.writeFileSync(filePath, content, 'utf8');

    // Act
    const result = parsePinnedFile(filePath);

    // Assert
    t.is(result.title, 'Обсуждения прошивок машины');
    t.is(result.updatedAt, '27.01.2026');
    t.is(result.links.length, 3);
    t.is(result.links[0].type, 'site-page');
    t.is(result.links[1].type, 'site-page');
    t.is(result.links[2].type, 'telegram-message');
});

test('parsePinnedFile() - should handle file with mixed link types', (t) => {
    // Arrange
    const dir = new TestDir();
    const pinnedDir = dir.getPinned();
    const filePath = path.join(pinnedDir, 'mixed.md');

    const content = `**Mixed Links**

[Site](https://voyahchat.ru/help)
[Telegram](https://t.me/voyahchat/11800/975515)
[External](https://example.com)`;

    fs.writeFileSync(filePath, content, 'utf8');

    // Act
    const result = parsePinnedFile(filePath);

    // Assert
    t.is(result.links.length, 3);
    t.is(result.links[0].type, 'site-page');
    t.is(result.links[1].type, 'telegram-message');
    t.is(result.links[2].type, 'external-link');
});
