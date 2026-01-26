const test = require('ava');
const { TelegramParser } = require('../lib/parser');

test('TelegramParser.extractReferencedMessages() - should extract message IDs from text', (t) => {
    // Arrange
    const testCases = [
        {
            text: 'See message https://t.me/testchat/123 for details',
            expected: [123],
        },
        {
            text: 'Check https://t.me/testchat/456 and https://t.me/testchat/789',
            expected: [456, 789],
        },
        {
            text: 'No references here',
            expected: [],
        },
        {
            text: 'Mixed text with https://t.me/testchat/999 and more text',
            expected: [999],
        },
    ];

    // Act & Assert
    for (const testCase of testCases) {
        const result = TelegramParser.extractReferencedMessages(testCase.text);
        t.deepEqual(result, testCase.expected);
    }
});

test('TelegramParser.extractReferencedMessages() - should handle edge cases', (t) => {
    // Arrange
    const testCases = [
        {
            text: 'See https://t.me/testchat/123 and https://t.me/testchat/123 again',
            expected: [123], // Duplicates are removed
        },
        {
            text: 'Invalid https://t.me/ and https://t.me/testchat/abc',
            expected: [],
        },
        {
            text: 'From https://t.me/otherchat/456 and https://t.me/testchat/789',
            expected: [456, 789],
        },
        {
            text: 'See https://t.me/testchat/123. And more!',
            expected: [123],
        },
    ];

    // Act & Assert
    for (const testCase of testCases) {
        const result = TelegramParser.extractReferencedMessages(testCase.text);
        t.deepEqual(result, testCase.expected);
    }
});

test('TelegramParser.parseMessage() - should parse basic message', (t) => {
    // Arrange
    const message = {
        id: 123,
        message: 'Hello world',
        date: new Date('2024-01-01T12:00:00Z'),
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(parsed.id, 123);
    t.is(parsed.text, 'Hello world');
    t.is(parsed.date, '2024-01-01T12:00:00.000Z');
    t.deepEqual(parsed.entities, []);
    t.deepEqual(parsed.media, []);
    t.deepEqual(parsed.referencedMessages, []);
});

test('TelegramParser.parseMessage() - should parse message with entities', (t) => {
    // Arrange
    const message = {
        id: 456,
        message: 'Bold and italic text',
        date: '2024-01-01T12:00:00Z',
        entities: [
            { className: 'MessageEntityBold', offset: 0, length: 4 },
            { className: 'MessageEntityItalic', offset: 9, length: 6 },
        ],
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(parsed.text, 'Bold and italic text');
    t.is(parsed.entities.length, 2);
    t.is(parsed.entities[0].className, 'MessageEntityBold');
    t.is(parsed.entities[1].className, 'MessageEntityItalic');
});

test('TelegramParser.parseMessage() - should extract references from text', (t) => {
    // Arrange
    const message = {
        id: 789,
        message: 'See https://t.me/testchat/123 for details',
        date: new Date(),
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.deepEqual(parsed.referencedMessages, [123]);
});

test('TelegramParser.parseMessage() - should handle message without text', (t) => {
    // Arrange
    const message = {
        id: 999,
        date: new Date(),
        media: { className: 'MessageMediaPhoto' },
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(parsed.text, '');
    t.deepEqual(parsed.referencedMessages, []);
});

test('TelegramParser.parseMessage() - should convert date to ISO string', (t) => {
    // Arrange
    const date = new Date('2024-01-15T10:30:45.123Z');
    const message = {
        id: 111,
        message: 'Test',
        date: date,
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(parsed.date, '2024-01-15T10:30:45.123Z');
});

test('TelegramParser.parseMessage() - should handle string date', (t) => {
    // Arrange
    const message = {
        id: 222,
        message: 'Test',
        date: '2024-01-20T15:45:30Z',
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(parsed.date, '2024-01-20T15:45:30.000Z');
});

test('TelegramParser.parseMessage() - should handle missing date', (t) => {
    // Arrange
    const message = {
        id: 333,
        message: 'Test',
    };

    // Act
    const parsed = TelegramParser.parseMessage(message);

    // Assert
    t.is(typeof parsed.date, 'string');
    // Should be a valid ISO date string
    t.regex(parsed.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Should be current date (within same day)
    const now = new Date().toISOString();
    t.is(parsed.date.substring(0, 10), now.substring(0, 10));
});

test('TelegramParser.parseUrl() - should parse valid t.me URLs', (t) => {
    // Arrange
    const testCases = [
        {
            url: 'https://t.me/testchat/123/456',
            expected: { topicId: 123, messageId: 456 },
        },
        {
            url: 'https://t.me/testchat/789',
            expected: { topicId: null, messageId: 789 },
        },
        {
            url: 'http://t.me/chat/111',
            expected: { topicId: null, messageId: 111 },
        },
    ];

    // Act & Assert
    for (const testCase of testCases) {
        const result = TelegramParser.parseUrl(testCase.url);
        t.deepEqual(result, testCase.expected);
    }
});

test('TelegramParser.parseUrl() - should return null for invalid URLs', (t) => {
    // Arrange
    const invalidUrls = [
        'https://example.com',
        'https://t.me/',
        'not a url',
        '',
    ];

    // Act & Assert
    for (const url of invalidUrls) {
        const result = TelegramParser.parseUrl(url);
        t.is(result, null);
    }
});

test('TelegramParser.hasLinks() - should detect t.me links correctly', (t) => {
    // Arrange
    const positiveCases = [
        'Check https://t.me/testchat/123',
        'See http://t.me/chat',
        'Multiple https://t.me/a and https://t.me/b',
    ];

    const negativeCases = [
        'No links here',
        'https://example.com is not telegram',
        '',
        null,
        undefined,
    ];

    // Act & Assert - Positive cases
    for (const text of positiveCases) {
        const result = TelegramParser.hasLinks(text);
        t.true(result);
    }

    // Act & Assert - Negative cases
    for (const text of negativeCases) {
        const result = TelegramParser.hasLinks(text);
        t.false(result);
    }
});
