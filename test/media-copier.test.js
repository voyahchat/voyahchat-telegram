const test = require('ava');
const fs = require('fs');
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const {
    copyMedia,
    copyMediaBatch,
    generateMediaFilename,
    getFileExtension,
} = require('../lib/media-copier');

// Tests for copyMedia
test('copyMedia() - should throw error when source path is missing', async (t) => {
    // Arrange
    const sourcePath = null;
    const targetDir = '/tmp/target';

    // Act & Assert
    await t.throwsAsync(
        async () => copyMedia(sourcePath, targetDir),
        { message: 'Source path is required' },
    );
});

test('copyMedia() - should throw error when target directory is missing', async (t) => {
    // Arrange
    const sourcePath = '/tmp/source.jpg';
    const targetDir = null;

    // Act & Assert
    await t.throwsAsync(
        async () => copyMedia(sourcePath, targetDir),
        { message: 'Target directory is required' },
    );
});

test('copyMedia() - should throw error when source file does not exist', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourcePath = path.join(dir.getRoot(), 'nonexistent.jpg');
    const targetDir = dir.getRoot();

    // Act & Assert
    await t.throwsAsync(
        async () => copyMedia(sourcePath, targetDir),
        { message: /Source file not found or not readable/ },
    );
});

test('copyMedia() - should copy file to target directory', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const sourcePath = path.join(sourceDir, 'test.jpg');
    await fs.promises.writeFile(sourcePath, 'test content', 'utf8');

    // Act
    const result = await copyMedia(sourcePath, targetDir);

    // Assert
    t.is(result.relativePath, 'test.jpg');
    t.is(result.skipped, false);
    t.true(fs.existsSync(result.targetPath));

    const copiedContent = await fs.promises.readFile(result.targetPath, 'utf8');
    t.is(copiedContent, 'test content');
});

test('copyMedia() - should rename file when rename option is provided', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const sourcePath = path.join(sourceDir, 'original.jpg');
    await fs.promises.writeFile(sourcePath, 'test content', 'utf8');

    // Act
    const result = await copyMedia(sourcePath, targetDir, { rename: 'renamed.jpg' });

    // Assert
    t.is(result.relativePath, 'renamed.jpg');
    t.true(fs.existsSync(result.targetPath));
    t.true(result.targetPath.endsWith('renamed.jpg'));
});

test('copyMedia() - should skip existing file when overwrite is false', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });
    await fs.promises.mkdir(targetDir, { recursive: true });

    const sourcePath = path.join(sourceDir, 'test.jpg');
    const targetPath = path.join(targetDir, 'test.jpg');

    await fs.promises.writeFile(sourcePath, 'new content', 'utf8');
    await fs.promises.writeFile(targetPath, 'existing content', 'utf8');

    // Act
    const result = await copyMedia(sourcePath, targetDir, { overwrite: false });

    // Assert
    t.is(result.skipped, true);

    const existingContent = await fs.promises.readFile(targetPath, 'utf8');
    t.is(existingContent, 'existing content');
});

test('copyMedia() - should overwrite existing file when overwrite is true', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });
    await fs.promises.mkdir(targetDir, { recursive: true });

    const sourcePath = path.join(sourceDir, 'test.jpg');
    const targetPath = path.join(targetDir, 'test.jpg');

    await fs.promises.writeFile(sourcePath, 'new content', 'utf8');
    await fs.promises.writeFile(targetPath, 'existing content', 'utf8');

    // Act
    const result = await copyMedia(sourcePath, targetDir, { overwrite: true });

    // Assert
    t.is(result.skipped, false);

    const newContent = await fs.promises.readFile(targetPath, 'utf8');
    t.is(newContent, 'new content');
});

test('copyMedia() - should create target directory if it does not exist', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'nested', 'target', 'dir');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const sourcePath = path.join(sourceDir, 'test.jpg');
    await fs.promises.writeFile(sourcePath, 'test content', 'utf8');

    // Act
    const result = await copyMedia(sourcePath, targetDir);

    // Assert
    t.true(fs.existsSync(targetDir));
    t.true(fs.existsSync(result.targetPath));
});

// Tests for copyMediaBatch
test('copyMediaBatch() - should return empty array for null media list', async (t) => {
    // Arrange
    const mediaList = null;
    const targetDir = '/tmp/target';

    // Act
    const result = await copyMediaBatch(mediaList, targetDir);

    // Assert
    t.deepEqual(result, []);
});

test('copyMediaBatch() - should return empty array for empty media list', async (t) => {
    // Arrange
    const mediaList = [];
    const targetDir = '/tmp/target';

    // Act
    const result = await copyMediaBatch(mediaList, targetDir);

    // Assert
    t.deepEqual(result, []);
});

test('copyMediaBatch() - should copy multiple files', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const file1 = path.join(sourceDir, 'file1.jpg');
    const file2 = path.join(sourceDir, 'file2.jpg');

    await fs.promises.writeFile(file1, 'content1', 'utf8');
    await fs.promises.writeFile(file2, 'content2', 'utf8');

    const mediaList = [
        { sourcePath: file1 },
        { sourcePath: file2 },
    ];

    // Act
    const result = await copyMediaBatch(mediaList, targetDir);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].skipped, false);
    t.is(result[1].skipped, false);
    t.true(fs.existsSync(result[0].targetPath));
    t.true(fs.existsSync(result[1].targetPath));
});

test('copyMediaBatch() - should handle individual file errors gracefully', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const validFile = path.join(sourceDir, 'valid.jpg');
    const invalidFile = path.join(sourceDir, 'nonexistent.jpg');

    await fs.promises.writeFile(validFile, 'content', 'utf8');

    const mediaList = [
        { sourcePath: validFile },
        { sourcePath: invalidFile },
    ];

    // Act
    const result = await copyMediaBatch(mediaList, targetDir);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].skipped, false);
    t.is(result[1].skipped, true);
    t.true(result[1].error.includes('Source file not found'));
});

test('copyMediaBatch() - should use individual rename options', async (t) => {
    // Arrange
    const dir = new TestDir();
    const sourceDir = path.join(dir.getRoot(), 'source');
    const targetDir = path.join(dir.getRoot(), 'target');

    await fs.promises.mkdir(sourceDir, { recursive: true });

    const file1 = path.join(sourceDir, 'file1.jpg');
    const file2 = path.join(sourceDir, 'file2.jpg');

    await fs.promises.writeFile(file1, 'content1', 'utf8');
    await fs.promises.writeFile(file2, 'content2', 'utf8');

    const mediaList = [
        { sourcePath: file1, rename: 'renamed1.jpg' },
        { sourcePath: file2, rename: 'renamed2.jpg' },
    ];

    // Act
    const result = await copyMediaBatch(mediaList, targetDir);

    // Assert
    t.is(result.length, 2);
    t.is(result[0].relativePath, 'renamed1.jpg');
    t.is(result[1].relativePath, 'renamed2.jpg');
});

// Tests for generateMediaFilename
test('generateMediaFilename() - should throw error when message ID is missing', (t) => {
    // Arrange
    const messageId = null;
    const mediaType = 'photo';
    const extension = 'jpg';

    // Act & Assert
    t.throws(
        () => generateMediaFilename(messageId, mediaType, extension),
        { message: 'Message ID is required' },
    );
});

test('generateMediaFilename() - should generate filename with message ID and type', (t) => {
    // Arrange
    const messageId = 12345;
    const mediaType = 'photo';
    const extension = 'jpg';

    // Act
    const result = generateMediaFilename(messageId, mediaType, extension);

    // Assert
    t.is(result, '12345-photo.jpg');
});

test('generateMediaFilename() - should handle extension with dot', (t) => {
    // Arrange
    const messageId = 12345;
    const mediaType = 'video';
    const extension = '.mp4';

    // Act
    const result = generateMediaFilename(messageId, mediaType, extension);

    // Assert
    t.is(result, '12345-video.mp4');
});

test('generateMediaFilename() - should use jpg as default extension', (t) => {
    // Arrange
    const messageId = 12345;
    const mediaType = 'photo';
    const extension = null;

    // Act
    const result = generateMediaFilename(messageId, mediaType, extension);

    // Assert
    t.is(result, '12345-photo.jpg');
});

test('generateMediaFilename() - should handle different media types', (t) => {
    // Arrange & Act & Assert
    t.is(generateMediaFilename(123, 'photo', 'jpg'), '123-photo.jpg');
    t.is(generateMediaFilename(456, 'video', 'mp4'), '456-video.mp4');
    t.is(generateMediaFilename(789, 'document', 'pdf'), '789-document.pdf');
});

// Tests for getFileExtension
test('getFileExtension() - should extract extension from file path', (t) => {
    // Arrange
    const filePath = '/path/to/file.jpg';

    // Act
    const result = getFileExtension(filePath);

    // Assert
    t.is(result, 'jpg');
});

test('getFileExtension() - should return empty string for file without extension', (t) => {
    // Arrange
    const filePath = '/path/to/file';

    // Act
    const result = getFileExtension(filePath);

    // Assert
    t.is(result, '');
});

test('getFileExtension() - should handle multiple dots in filename', (t) => {
    // Arrange
    const filePath = '/path/to/file.name.with.dots.jpg';

    // Act
    const result = getFileExtension(filePath);

    // Assert
    t.is(result, 'jpg');
});

test('getFileExtension() - should handle uppercase extensions', (t) => {
    // Arrange
    const filePath = '/path/to/file.JPG';

    // Act
    const result = getFileExtension(filePath);

    // Assert
    t.is(result, 'JPG');
});
