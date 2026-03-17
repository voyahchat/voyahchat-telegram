const test = require('ava');
const { MarkdownConverter } = require('../lib/markdown');

// Tests for toTelegram method
test('MarkdownConverter.toTelegram() - should return empty result for falsy inputs', (t) => {
    // Test multiple falsy inputs in one test
    const falsyInputs = ['', null, undefined];

    for (const markdown of falsyInputs) {
        const result = MarkdownConverter.toTelegram(markdown);
        t.is(result.text, '');
        t.deepEqual(result.entities, []);
    }
});

test('MarkdownConverter.toTelegram() - should handle plain text without markdown', (t) => {
    // Arrange
    const markdown = 'This is plain text';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'This is plain text');
    t.deepEqual(result.entities, []);
});

test('MarkdownConverter.toTelegram() - should convert bold text correctly', (t) => {
    // Arrange
    const markdown = 'This is **bold** text';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'This is bold text');
    t.is(result.entities.length, 1);
    t.is(result.entities[0].type, 'bold');
    t.is(result.entities[0].offset, 8);
    t.is(result.entities[0].length, 4);
});

test('MarkdownConverter.toTelegram() - should convert multiple bold text segments', (t) => {
    // Arrange
    const markdown = '**First** and **second** bold';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'First and second bold');
    t.is(result.entities.length, 2);
    t.is(result.entities[0].type, 'bold');
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 5);
    t.is(result.entities[1].type, 'bold');
    t.is(result.entities[1].offset, 10);
    t.is(result.entities[1].length, 6);
});

test('MarkdownConverter.toTelegram() - should convert markdown links correctly', (t) => {
    // Arrange
    const markdown = 'Visit [Google](https://google.com) for search';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Visit Google for search');
    t.is(result.entities.length, 1);
    t.is(result.entities[0].type, 'text_link');
    t.is(result.entities[0].offset, 6);
    t.is(result.entities[0].length, 6);
    t.is(result.entities[0].url, 'https://google.com');
});

test('MarkdownConverter.toTelegram() - should convert multiple markdown links', (t) => {
    // Arrange
    const markdown = '[Google](https://google.com) and [Yandex](https://yandex.com)';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Google and Yandex');
    t.is(result.entities.length, 2);
    t.is(result.entities[0].type, 'text_link');
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 6);
    t.is(result.entities[0].url, 'https://google.com');
    t.is(result.entities[1].type, 'text_link');
    t.is(result.entities[1].offset, 11);
    t.is(result.entities[1].length, 6);
    t.is(result.entities[1].url, 'https://yandex.com');
});

test('MarkdownConverter.toTelegram() - should handle plain URLs without markdown', (t) => {
    // Arrange
    const markdown = 'Visit https://google.com for search';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Visit https://google.com for search');
    t.deepEqual(result.entities, []);
});

test('MarkdownConverter.toTelegram() - should handle combination of bold and links', (t) => {
    // Arrange
    const markdown = '**Bold** and [link](https://example.com)';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Bold and link');
    t.is(result.entities.length, 2);
    t.is(result.entities[0].type, 'bold');
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 4);
    t.is(result.entities[1].type, 'text_link');
    t.is(result.entities[1].offset, 9);
    t.is(result.entities[1].length, 4);
    t.is(result.entities[1].url, 'https://example.com');
});

test('MarkdownConverter.toTelegram() - should handle nested formatting', (t) => {
    // Test nested bold in links
    const markdown1 = '[**bold link**](https://example.com)';
    const result1 = MarkdownConverter.toTelegram(markdown1);

    // The link should contain bold text
    t.is(result1.entities.length, 2);
    const linkEntity1 = result1.entities.find(e => e.type === 'text_link');
    t.is(linkEntity1.url, 'https://example.com');
    const boldEntity1 = result1.entities.find(e => e.type === 'bold');
    t.is(typeof boldEntity1, 'object');

    // Test links in bold text
    const markdown2 = '**bold [link](https://example.com) text**';
    const result2 = MarkdownConverter.toTelegram(markdown2);

    // Should have both bold and link entities
    t.true(result2.entities.length >= 2, 'Should have at least 2 entities (bold and link)');
    const linkEntity2 = result2.entities.find(e => e.type === 'text_link');
    t.is(linkEntity2.url, 'https://example.com');
    const boldEntity2 = result2.entities.find(e => e.type === 'bold');
    t.is(typeof boldEntity2, 'object');
});

test('MarkdownConverter.toTelegram() - should handle edge cases', (t) => {
    // Test empty bold text
    const markdown1 = 'This is **** text';
    const result1 = MarkdownConverter.toTelegram(markdown1);
    t.is(result1.text, 'This is **** text');
    t.deepEqual(result1.entities, []);

    // Test empty link text
    const markdown2 = 'This is [](https://example.com) link';
    const result2 = MarkdownConverter.toTelegram(markdown2);
    t.is(result2.text, 'This is [](https://example.com) link');
    t.deepEqual(result2.entities, []);

    // Test malformed bold text
    const markdown3 = 'This is **bold text';
    const result3 = MarkdownConverter.toTelegram(markdown3);
    t.is(result3.text, 'This is **bold text');
    t.deepEqual(result3.entities, []);

    // Test malformed link
    const markdown4 = 'This is [link(https://example.com) text';
    const result4 = MarkdownConverter.toTelegram(markdown4);
    t.is(result4.text, 'This is [link(https://example.com) text');
    t.deepEqual(result4.entities, []);

    // Test unicode characters
    const markdown5 = 'Hello **world** with emoji and cyrillic';
    const result5 = MarkdownConverter.toTelegram(markdown5);
    t.is(result5.text, 'Hello world with emoji and cyrillic');
    t.is(result5.entities.length, 1);
    t.is(result5.entities[0].type, 'bold');

    // Test multiple asterisks
    const markdown6 = 'Text with *** three asterisks';
    const result6 = MarkdownConverter.toTelegram(markdown6);
    t.is(result6.text, 'Text with *** three asterisks');
    t.deepEqual(result6.entities, []);

    // Test adjacent bold segments
    const markdown7 = '**First****Second**';
    const result7 = MarkdownConverter.toTelegram(markdown7);
    t.true(result7.text.includes('First'));
    t.true(result7.text.includes('Second'));

    // Test link with special characters in URL
    const markdown8 = 'Visit [link](https://example.com/path?query=value&other=123)';
    const result8 = MarkdownConverter.toTelegram(markdown8);
    t.is(result8.text, 'Visit link');
    t.is(result8.entities.length, 1);
    t.is(result8.entities[0].url, 'https://example.com/path?query=value&other=123');
});

test('MarkdownConverter.toTelegram() - should handle multiple bold on separate lines', (t) => {
    // Arrange
    const markdown = '**First**\n\n**Second**';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'First\n\nSecond');
    t.is(result.entities.length, 2);

    // First bold: "First" at position 0
    t.is(result.entities[0].type, 'bold');
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 5);

    // Second bold: "Second" at position 7 (after "First\n\n")
    t.is(result.entities[1].type, 'bold');
    t.is(result.entities[1].offset, 7);
    t.is(result.entities[1].length, 6);
});

test('MarkdownConverter.toTelegram() - should handle bold followed by link', (t) => {
    // Arrange
    const markdown = '**Title**\n[link](https://example.com)';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Title\nlink');
    t.is(result.entities.length, 2);

    // Bold: "Title" at position 0
    t.is(result.entities[0].type, 'bold');
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 5);

    // Link: "link" at position 6 (after "Title\n")
    t.is(result.entities[1].type, 'text_link');
    t.is(result.entities[1].offset, 6);
    t.is(result.entities[1].length, 4);
    t.is(result.entities[1].url, 'https://example.com');
});

test('MarkdownConverter.toTelegram() - should handle complex multiline content', (t) => {
    // Arrange - similar to actual registration.md structure
    const markdown = '**Header**\n\n**Section**\n[link](https://example.com)\n\n**Another**';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Header\n\nSection\nlink\n\nAnother');
    t.is(result.entities.length, 4);

    // Verify all entities have valid offsets within the text
    for (const entity of result.entities) {
        t.true(
            entity.offset >= 0,
            `Entity offset ${entity.offset} should be >= 0`,
        );
        t.true(
            entity.offset < result.text.length,
            `Entity offset ${entity.offset} should be < text length ${result.text.length}`,
        );
        t.true(
            entity.offset + entity.length <= result.text.length,
            `Entity end ${entity.offset + entity.length} should be <= text length ${result.text.length}`,
        );
    }
});

// Tests for fromTelegram method
test('MarkdownConverter.fromTelegram() - should return empty string for falsy inputs', (t) => {
    // Test multiple falsy inputs in one test
    const falsyInputs = ['', null];

    for (const text of falsyInputs) {
        const result = MarkdownConverter.fromTelegram(text, []);
        t.is(result, '');
    }
});

test('MarkdownConverter.fromTelegram() - should return plain text when no entities', (t) => {
    // Arrange
    const text = 'This is plain text';
    const entities = [];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is plain text');
});

test('MarkdownConverter.fromTelegram() - should return plain text when entities is null', (t) => {
    // Arrange
    const text = 'This is plain text';
    const entities = null;

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is plain text');
});

test('MarkdownConverter.fromTelegram() - should convert bold entities to markdown', (t) => {
    // Arrange
    const text = 'This is bold text';
    const entities = [
        { type: 'bold', offset: 8, length: 4 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is **bold** text');
});

test('MarkdownConverter.fromTelegram() - should convert multiple bold entities', (t) => {
    // Arrange
    const text = 'First and second bold';
    const entities = [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'bold', offset: 10, length: 6 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, '**First** and **second** bold');
});

test('MarkdownConverter.fromTelegram() - should convert text_link entities to markdown', (t) => {
    // Arrange
    const text = 'Visit Google for search';
    const entities = [
        { type: 'text_link', offset: 6, length: 6, url: 'https://google.com' },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'Visit [Google](https://google.com) for search');
});

test('MarkdownConverter.fromTelegram() - should convert multiple text_link entities', (t) => {
    // Arrange
    const text = 'Google and Yandex';
    const entities = [
        { type: 'text_link', offset: 0, length: 6, url: 'https://google.com' },
        { type: 'text_link', offset: 11, length: 6, url: 'https://yandex.com' },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, '[Google](https://google.com) and [Yandex](https://yandex.com)');
});

test('MarkdownConverter.fromTelegram() - should handle edge cases', (t) => {
    // Test text_link without URL
    const text1 = 'Visit Google for search';
    const entities1 = [
        { type: 'text_link', offset: 6, length: 6 },
    ];
    const result1 = MarkdownConverter.fromTelegram(text1, entities1);
    t.is(result1, 'Visit [Google]() for search');

    // Test combination of bold and text_link
    const text2 = 'Bold and link';
    const entities2 = [
        { type: 'bold', offset: 0, length: 4 },
        { type: 'text_link', offset: 9, length: 4, url: 'https://example.com' },
    ];
    const result2 = MarkdownConverter.fromTelegram(text2, entities2);
    t.is(result2, '**Bold** and [link](https://example.com)');

    // Test unknown entity types
    const text3 = 'Some text';
    const entities3 = [
        { type: 'unknown', offset: 0, length: 4 },
    ];
    const result3 = MarkdownConverter.fromTelegram(text3, entities3);
    t.is(result3, 'Some text');

    // Test overlapping entities gracefully
    const text4 = 'Some text here';
    const entities4 = [
        { type: 'bold', offset: 0, length: 9 },
        { type: 'bold', offset: 5, length: 9 },
    ];
    // Should not throw
    t.notThrows(() => MarkdownConverter.fromTelegram(text4, entities4));
});

// Tests for compare method
test('MarkdownConverter.compare() - should handle null/empty inputs', (t) => {
    t.true(MarkdownConverter.compare('', ''));
    t.true(MarkdownConverter.compare(null, null));
    t.false(MarkdownConverter.compare(null, 'some text'));
    t.false(MarkdownConverter.compare('', 'some text'));
});

test('MarkdownConverter.compare() - should compare plain text correctly', (t) => {
    // Test identical plain text
    t.true(MarkdownConverter.compare('This is plain text', 'This is plain text'));

    // Test different plain text
    t.false(MarkdownConverter.compare('This is text one', 'This is text two'));

    // Test whitespace differences
    t.true(MarkdownConverter.compare('Text with  double spaces', 'Text with  double spaces'));
});

test('MarkdownConverter.compare() - should compare bold text correctly', (t) => {
    // Test identical bold text
    t.true(MarkdownConverter.compare('This is **bold** text', 'This is **bold** text'));

    // Test different bold text
    t.false(MarkdownConverter.compare('This is **bold** text', 'This is **bolded** text'));
});

test('MarkdownConverter.compare() - should compare links correctly', (t) => {
    // Test identical links
    t.true(MarkdownConverter.compare(
        'Visit [Google](https://google.com) for search',
        'Visit [Google](https://google.com) for search',
    ));

    // Test different link URLs
    t.false(MarkdownConverter.compare(
        'Visit [Google](https://google.com) for search',
        'Visit [Google](https://yandex.com) for search',
    ));

    // Test different link text
    t.false(MarkdownConverter.compare(
        'Visit [Google](https://google.com) for search',
        'Visit [Yandex](https://google.com) for search',
    ));
});

test('MarkdownConverter.compare() - should compare complex markdown correctly', (t) => {
    // Test equivalent markdown with different formatting
    t.true(MarkdownConverter.compare(
        '**Bold** and [link](https://example.com)',
        '**Bold** and [link](https://example.com)',
    ));

    // Test different entity positions
    t.false(MarkdownConverter.compare('**Bold** and link', 'Bold and **link**'));

    // Test complex equivalent markdown
    t.true(MarkdownConverter.compare(
        '**First** and **second** bold with [link1](https://example1.com) and [link2](https://example2.com)',
        '**First** and **second** bold with [link1](https://example1.com) and [link2](https://example2.com)',
    ));
});

// Round-trip tests
test('MarkdownConverter.toTelegram() - should handle round-trip conversion for plain text', (t) => {
    // Arrange
    const original = 'This is plain text';

    // Act
    const telegram = MarkdownConverter.toTelegram(original);
    const result = MarkdownConverter.fromTelegram(telegram.text, telegram.entities);

    // Assert
    t.is(result, original);
});

test('MarkdownConverter.toTelegram() - should handle round-trip conversion for bold text', (t) => {
    // Arrange
    const original = 'This is **bold** text';

    // Act
    const telegram = MarkdownConverter.toTelegram(original);
    const result = MarkdownConverter.fromTelegram(telegram.text, telegram.entities);

    // Assert
    t.is(result, original);
});

test('MarkdownConverter.toTelegram() - should handle round-trip conversion for complex multiline content', (t) => {
    // Arrange - structure similar to registration.md
    const original = `**Header Title**

**Section One**
[link1](https://example1.com)

**Section Two with longer text**
[link2](https://example2.com)

**Final Section**
[link3](https://example3.com)`;

    // Act
    const telegram = MarkdownConverter.toTelegram(original);
    const result = MarkdownConverter.fromTelegram(telegram.text, telegram.entities);

    // Assert
    t.is(result, original);
});

test('MarkdownConverter.toTelegram() - should handle Cyrillic text with multiple formatting', (t) => {
    // Arrange - Cyrillic content similar to actual usage
    const markdown = '**Заголовок**\n\n**Раздел**\n[ссылка](https://example.com)';

    // Act
    const result = MarkdownConverter.toTelegram(markdown);

    // Assert
    t.is(result.text, 'Заголовок\n\nРаздел\nссылка');
    t.is(result.entities.length, 3);

    // Verify offsets are correct for Cyrillic text
    t.is(result.entities[0].offset, 0);
    t.is(result.entities[0].length, 9); // "Заголовок"

    t.is(result.entities[1].offset, 11); // After "Заголовок\n\n"
    t.is(result.entities[1].length, 6); // "Раздел"

    t.is(result.entities[2].offset, 18); // After "Заголовок\n\nРаздел\n"
    t.is(result.entities[2].length, 6); // "ссылка"
});

test('MarkdownConverter.toTelegram() - should handle round-trip conversion for links', (t) => {
    // Arrange
    const original = 'Visit [Google](https://google.com) for search';

    // Act
    const telegram = MarkdownConverter.toTelegram(original);
    const result = MarkdownConverter.fromTelegram(telegram.text, telegram.entities);

    // Assert
    t.is(result, original);
});

test('MarkdownConverter.fromTelegram() - should convert italic entities', (t) => {
    // Arrange
    const text = 'This is italic text';
    const entities = [
        { className: 'MessageEntityItalic', offset: 8, length: 6 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is _italic_ text');
});

test('MarkdownConverter.fromTelegram() - should convert code entities', (t) => {
    // Arrange
    const text = 'Use the command function';
    const entities = [
        { className: 'MessageEntityCode', offset: 8, length: 7 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'Use the `command` function');
});

test('MarkdownConverter.fromTelegram() - should convert strikethrough entities', (t) => {
    // Arrange
    const text = 'This is deleted text';
    const entities = [
        { className: 'MessageEntityStrike', offset: 8, length: 7 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is ~~deleted~~ text');
});

test('MarkdownConverter.fromTelegram() - should convert underline entities to HTML', (t) => {
    // Arrange
    const text = 'This is underlined text';
    const entities = [
        { className: 'MessageEntityUnderline', offset: 8, length: 10 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is <u>underlined</u> text');
});

test('MarkdownConverter.fromTelegram() - should convert spoiler entities', (t) => {
    // Arrange
    const text = 'This is spoiler text';
    const entities = [
        { className: 'MessageEntitySpoiler', offset: 8, length: 7 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, 'This is ||spoiler|| text');
});

test('MarkdownConverter.fromTelegram() - should handle multiple entity types', (t) => {
    // Arrange
    const text = 'Bold and italic and code';
    const entities = [
        { className: 'MessageEntityBold', offset: 0, length: 4 },
        { className: 'MessageEntityItalic', offset: 9, length: 6 },
        { className: 'MessageEntityCode', offset: 20, length: 4 },
    ];

    // Act
    const result = MarkdownConverter.fromTelegram(text, entities);

    // Assert
    t.is(result, '**Bold** and _italic_ and `code`');
});

test('MarkdownConverter.normalizeEntityType() - should normalize className to type', (t) => {
    // Arrange & Act & Assert
    t.is(MarkdownConverter.normalizeEntityType({ className: 'MessageEntityBold' }), 'bold');
    t.is(MarkdownConverter.normalizeEntityType({ className: 'MessageEntityItalic' }), 'italic');
    t.is(MarkdownConverter.normalizeEntityType({ className: 'MessageEntityCode' }), 'code');
    t.is(MarkdownConverter.normalizeEntityType({ className: 'MessageEntityTextUrl' }), 'text_link');
    t.is(MarkdownConverter.normalizeEntityType({ className: 'MessageEntityStrike' }), 'strikethrough');
});

test('MarkdownConverter.normalizeEntityType() - should use type field if no className', (t) => {
    // Arrange & Act & Assert
    t.is(MarkdownConverter.normalizeEntityType({ type: 'bold' }), 'bold');
    t.is(MarkdownConverter.normalizeEntityType({ type: 'italic' }), 'italic');
});

test('MarkdownConverter.normalizeEntityType() - should return empty string for unknown', (t) => {
    // Arrange & Act & Assert
    t.is(MarkdownConverter.normalizeEntityType({}), '');
});

// --- toTelegramHtml() tests ---

test('MarkdownConverter.toTelegramHtml() - should return empty result for falsy inputs', (t) => {
    const falsyInputs = ['', null, undefined];

    for (const markdown of falsyInputs) {
        const result = MarkdownConverter.toTelegramHtml(markdown);
        t.is(result, '');
    }
});

test('MarkdownConverter.toTelegramHtml() - should convert bold to <b> tags', (t) => {
    const markdown = 'This is **bold** text';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, 'This is <b>bold</b> text');
});

test('MarkdownConverter.toTelegramHtml() - should convert links to <a> tags', (t) => {
    const markdown = 'Visit [Google](https://google.com) for search';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, 'Visit <a href="https://google.com">Google</a> for search');
});

test('MarkdownConverter.toTelegramHtml() - should escape HTML special chars', (t) => {
    const markdown = 'Text with < > & special chars';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, 'Text with < > & special chars');
});

test('MarkdownConverter.toTelegramHtml() - should escape HTML in link text but not URL', (t) => {
    const markdown = 'Visit [Link <test>](https://example.com) here';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, 'Visit <a href="https://example.com">Link <test></a> here');
});

test('MarkdownConverter.toTelegramHtml() - should handle multiple bold segments', (t) => {
    const markdown = '**First** and **second** bold';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, '<b>First</b> and <b>second</b> bold');
});

test('MarkdownConverter.toTelegramHtml() - should handle multiple links', (t) => {
    const markdown = '[Google](https://google.com) and [Yandex](https://yandex.com)';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, '<a href="https://google.com">Google</a> and <a href="https://yandex.com">Yandex</a>');
});

test('MarkdownConverter.toTelegramHtml() - should handle combination of bold and links', (t) => {
    const markdown = '**Bold** and [link](https://example.com)';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, '<b>Bold</b> and <a href="https://example.com">link</a>');
});

test('MarkdownConverter.toTelegramHtml() - should handle nested formatting', (t) => {
    const markdown = '[**bold link**](https://example.com)';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, '<a href="https://example.com"><b>bold link</b></a>');
});

test('MarkdownConverter.toTelegramHtml() - should handle text without formatting', (t) => {
    const markdown = 'Plain text without any formatting';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, 'Plain text without any formatting');
});

test('MarkdownConverter.toTelegramHtml() - should handle Cyrillic text', (t) => {
    const markdown = '**Постановка на учёт**, обновлено 27.01.2026';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.is(result, '<b>Постановка на учёт</b>, обновлено 27.01.2026');
});

test('MarkdownConverter.toTelegramHtml() - should handle registration.md content structure', (t) => {
    const markdown = '**Постановка на учёт**, обновлено 27.01.2026\n\n' +
        '**Платные услуги чата**\n[voyahchat.ru/help](https://voyahchat.ru/help)';
    const result = MarkdownConverter.toTelegramHtml(markdown);

    t.true(result.includes('<b>Постановка на учёт</b>'));
    t.true(result.includes('<b>Платные услуги чата</b>'));
    t.true(result.includes('<a href="https://voyahchat.ru/help">voyahchat.ru/help</a>'));
});

test('MarkdownConverter.toTelegramHtml() - should handle edge cases', (t) => {
    // Empty bold text
    const result1 = MarkdownConverter.toTelegramHtml('This is **** text');
    t.is(result1, 'This is **** text');

    // Empty link text
    const result2 = MarkdownConverter.toTelegramHtml('This is [](https://example.com) link');
    t.is(result2, 'This is [](https://example.com) link');

    // Malformed bold text
    const result3 = MarkdownConverter.toTelegramHtml('This is **bold text');
    t.is(result3, 'This is **bold text');

    // Malformed link
    const result4 = MarkdownConverter.toTelegramHtml('This is [link(https://example.com) text');
    t.is(result4, 'This is [link(https://example.com) text');
});
