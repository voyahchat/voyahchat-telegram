const test = require('ava');
const {
    convertMessageToMarkdown,
    applyEntitiesToText,
    convertMediaToMarkdown,
} = require('../lib/telegram-to-markdown');

// Tests for convertMessageToMarkdown
test('convertMessageToMarkdown() - should return empty string for null message', (t) => {
    // Arrange
    const message = null;

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, '');
});

test('convertMessageToMarkdown() - should handle plain text without entities', (t) => {
    // Arrange
    const message = {
        text: 'This is plain text',
        entities: [],
    };

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, 'This is plain text');
});

test('convertMessageToMarkdown() - should convert bold entity to markdown', (t) => {
    // Arrange
    const message = {
        text: 'This is bold text',
        entities: [
            { type: 'bold', offset: 8, length: 4 },
        ],
    };

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, 'This is **bold** text');
});

test('convertMessageToMarkdown() - should convert textLink entity to markdown', (t) => {
    // Arrange
    const message = {
        text: 'Visit Google for search',
        entities: [
            { type: 'textLink', offset: 6, length: 6, url: 'https://google.com' },
        ],
    };

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, 'Visit [Google](https://google.com) for search');
});

test('convertMessageToMarkdown() - should handle multiple entities', (t) => {
    // Arrange
    const message = {
        text: 'Bold and link text',
        entities: [
            { type: 'bold', offset: 0, length: 4 },
            { type: 'textLink', offset: 9, length: 4, url: 'https://example.com' },
        ],
    };

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, '**Bold** and [link](https://example.com) text');
});

test('convertMessageToMarkdown() - should include media when includeMedia is true', (t) => {
    // Arrange
    const message = {
        text: 'Check this photo',
        entities: [],
        media: [
            { type: 'photo', filename: 'photo.jpg' },
        ],
    };

    // Act
    const result = convertMessageToMarkdown(message, { includeMedia: true });

    // Assert
    t.true(result.includes('Check this photo'));
    t.true(result.includes('![](photo.jpg)'));
});

test('convertMessageToMarkdown() - should exclude media when includeMedia is false', (t) => {
    // Arrange
    const message = {
        text: 'Check this photo',
        entities: [],
        media: [
            { type: 'photo', filename: 'photo.jpg' },
        ],
    };

    // Act
    const result = convertMessageToMarkdown(message, { includeMedia: false });

    // Assert
    t.is(result, 'Check this photo');
});

test('convertMessageToMarkdown() - should handle empty message', (t) => {
    // Arrange
    const message = {};

    // Act
    const result = convertMessageToMarkdown(message);

    // Assert
    t.is(result, '');
});

// Tests for applyEntitiesToText
test('applyEntitiesToText() - should return empty string for empty text', (t) => {
    // Arrange
    const text = '';
    const entities = [];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, '');
});

test('applyEntitiesToText() - should return plain text when no entities', (t) => {
    // Arrange
    const text = 'Plain text';
    const entities = [];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Plain text');
});

test('applyEntitiesToText() - should convert bold entity', (t) => {
    // Arrange
    const text = 'This is bold text';
    const entities = [
        { type: 'bold', offset: 8, length: 4 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is **bold** text');
});

test('applyEntitiesToText() - should convert italic entity', (t) => {
    // Arrange
    const text = 'This is italic text';
    const entities = [
        { type: 'italic', offset: 8, length: 6 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is *italic* text');
});

test('applyEntitiesToText() - should convert code entity', (t) => {
    // Arrange
    const text = 'Use the command function';
    const entities = [
        { type: 'code', offset: 8, length: 7 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Use the `command` function');
});

test('applyEntitiesToText() - should convert pre entity', (t) => {
    // Arrange
    const text = 'Code block here';
    const entities = [
        { type: 'pre', offset: 0, length: 10 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, '```\nCode block\n``` here');
});

test('applyEntitiesToText() - should convert text_link entity', (t) => {
    // Arrange
    const text = 'Visit Google here';
    const entities = [
        { type: 'text_link', offset: 6, length: 6, url: 'https://google.com' },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Visit [Google](https://google.com) here');
});

test('applyEntitiesToText() - should convert mention entity', (t) => {
    // Arrange
    const text = 'Hello username there';
    const entities = [
        { type: 'mention', offset: 6, length: 8 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Hello @username there');
});

test('applyEntitiesToText() - should keep url entity as is', (t) => {
    // Arrange
    const text = 'Visit https://example.com here';
    const entities = [
        { type: 'url', offset: 6, length: 19 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Visit https://example.com here');
});

test('applyEntitiesToText() - should convert strikethrough entity', (t) => {
    // Arrange
    const text = 'This is deleted text';
    const entities = [
        { type: 'strikethrough', offset: 8, length: 7 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is ~~deleted~~ text');
});

test('applyEntitiesToText() - should convert underline entity', (t) => {
    // Arrange
    const text = 'This is underlined text';
    const entities = [
        { type: 'underline', offset: 8, length: 10 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is <u>underlined</u> text');
});

test('applyEntitiesToText() - should convert spoiler entity', (t) => {
    // Arrange
    const text = 'This is spoiler text';
    const entities = [
        { type: 'spoiler', offset: 8, length: 7 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is ||spoiler|| text');
});

test('applyEntitiesToText() - should handle multiple entities correctly', (t) => {
    // Arrange
    const text = 'First and second bold';
    const entities = [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'bold', offset: 10, length: 6 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, '**First** and **second** bold');
});

test('applyEntitiesToText() - should handle className from gramJS', (t) => {
    // Arrange
    const text = 'This is bold text';
    const entities = [
        { className: 'MessageEntityBold', offset: 8, length: 4 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'This is **bold** text');
});

test('applyEntitiesToText() - should handle unknown entity types gracefully', (t) => {
    // Arrange
    const text = 'Some text here';
    const entities = [
        { type: 'unknown_type', offset: 5, length: 4 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Some text here');
});

test('applyEntitiesToText() - should handle Cyrillic text', (t) => {
    // Arrange
    const text = 'Это жирный текст';
    const entities = [
        { type: 'bold', offset: 4, length: 6 },
    ];

    // Act
    const result = applyEntitiesToText(text, entities);

    // Assert
    t.is(result, 'Это **жирный** текст');
});

// Tests for convertMediaToMarkdown
test('convertMediaToMarkdown() - should return empty string for null media', (t) => {
    // Arrange
    const media = null;

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '');
});

test('convertMediaToMarkdown() - should return empty string for empty array', (t) => {
    // Arrange
    const media = [];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '');
});

test('convertMediaToMarkdown() - should convert photo to markdown image', (t) => {
    // Arrange
    const media = [
        { type: 'photo', filename: 'photo.jpg' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '![](photo.jpg)');
});

test('convertMediaToMarkdown() - should convert photo with caption', (t) => {
    // Arrange
    const media = [
        { type: 'photo', filename: 'photo.jpg', caption: 'My photo' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '![My photo](photo.jpg)');
});

test('convertMediaToMarkdown() - should convert video to markdown link', (t) => {
    // Arrange
    const media = [
        { type: 'video', filename: 'video.mp4' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '[video.mp4](video.mp4)');
});

test('convertMediaToMarkdown() - should convert document to markdown link', (t) => {
    // Arrange
    const media = [
        { type: 'document', filename: 'document.pdf' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '[document.pdf](document.pdf)');
});

test('convertMediaToMarkdown() - should handle multiple media items', (t) => {
    // Arrange
    const media = [
        { type: 'photo', filename: 'photo1.jpg' },
        { type: 'photo', filename: 'photo2.jpg' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '![](photo1.jpg)\n![](photo2.jpg)');
});

test('convertMediaToMarkdown() - should use localPath if filename not available', (t) => {
    // Arrange
    const media = [
        { type: 'photo', localPath: 'media/123.jpg' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '![](media/123.jpg)');
});

test('convertMediaToMarkdown() - should use file property as fallback', (t) => {
    // Arrange
    const media = [
        { type: 'photo', file: 'image.png' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '![](image.png)');
});

test('convertMediaToMarkdown() - should handle unknown media type', (t) => {
    // Arrange
    const media = [
        { type: 'unknown', filename: 'file.dat' },
    ];

    // Act
    const result = convertMediaToMarkdown(media);

    // Assert
    t.is(result, '[file.dat](file.dat)');
});
