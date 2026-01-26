const test = require('ava');
const fs = require('fs').promises;
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const {
    getDirectorySize,
    calculateSectionSize,
    ensureDir,
} = require('../lib/download-utils');

test.beforeEach(async (t) => {
    // Create test directory
    const dir = new TestDir();
    t.context.dir = dir;
    t.context.testDir = dir.getDownloaded();
});

test('getDirectorySize() - should return 0 for empty directory', async (t) => {
    // Arrange
    const emptyDir = path.join(t.context.testDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    // Act
    const size = await getDirectorySize(emptyDir);

    // Assert
    t.is(size, 0);
});

test('getDirectorySize() - should calculate size of directory with files', async (t) => {
    // Arrange
    const testDir = path.join(t.context.testDir, 'with-files');
    await fs.mkdir(testDir, { recursive: true });

    const file1Path = path.join(testDir, 'file1.txt');
    const file2Path = path.join(testDir, 'file2.txt');

    const content1 = 'Hello, world!';
    const content2 = 'This is a test file with more content.';

    await fs.writeFile(file1Path, content1);
    await fs.writeFile(file2Path, content2);

    // Act
    const size = await getDirectorySize(testDir);

    // Assert
    const expectedSize = Buffer.byteLength(content1) + Buffer.byteLength(content2);
    t.is(size, expectedSize);
});

test('getDirectorySize() - should calculate size recursively for nested directories', async (t) => {
    // Arrange
    const rootDir = path.join(t.context.testDir, 'nested');
    const subDir = path.join(rootDir, 'subdir');
    const subSubDir = path.join(subDir, 'subsubdir');

    await fs.mkdir(subSubDir, { recursive: true });

    const rootFile = path.join(rootDir, 'root.txt');
    const subFile = path.join(subDir, 'sub.txt');
    const subSubFile = path.join(subSubDir, 'subsub.txt');

    const rootContent = 'Root file content';
    const subContent = 'Sub directory file content';
    const subSubContent = 'Nested sub-sub directory file content';

    await fs.writeFile(rootFile, rootContent);
    await fs.writeFile(subFile, subContent);
    await fs.writeFile(subSubFile, subSubContent);

    // Act
    const size = await getDirectorySize(rootDir);

    // Assert
    const expectedSize = Buffer.byteLength(rootContent) +
                        Buffer.byteLength(subContent) +
                        Buffer.byteLength(subSubContent);
    t.is(size, expectedSize);
});

test('getDirectorySize() - should handle errors gracefully with log function', async (t) => {
    // Arrange
    const nonExistentDir = path.join(t.context.testDir, 'non-existent');
    const logMessages = [];
    const logFn = (message) => logMessages.push(message);

    // Act
    const size = await getDirectorySize(nonExistentDir, logFn);

    // Assert
    t.is(size, 0);
    t.is(logMessages.length, 1);
    t.true(logMessages[0].includes('Error calculating directory size'));
    t.true(logMessages[0].includes(nonExistentDir));
});

test('getDirectorySize() - should handle errors gracefully without log function', async (t) => {
    // Arrange
    const nonExistentDir = path.join(t.context.testDir, 'non-existent');

    // Act
    const size = await getDirectorySize(nonExistentDir);

    // Assert
    t.is(size, 0);
});

test('calculateSectionSize() - should add bytes to section stats for existing directory', async (t) => {
    // Arrange
    const sectionDir = path.join(t.context.testDir, 'section');
    await fs.mkdir(sectionDir, { recursive: true });

    const filePath = path.join(sectionDir, 'test.txt');
    const content = 'Test content for section size calculation';
    await fs.writeFile(filePath, content);

    const mockSectionStats = {
        addedBytes: 0,
        addCachedBytes(bytes) {
            this.addedBytes += bytes;
        },
    };

    // Act
    await calculateSectionSize(sectionDir, mockSectionStats);

    // Assert
    t.is(mockSectionStats.addedBytes, Buffer.byteLength(content));
});

test('calculateSectionSize() - should not add bytes for empty directory', async (t) => {
    // Arrange
    const emptyDir = path.join(t.context.testDir, 'empty-section');
    await fs.mkdir(emptyDir, { recursive: true });

    const mockSectionStats = {
        addedBytes: 0,
        addCachedBytes(bytes) {
            this.addedBytes += bytes;
        },
    };

    // Act
    await calculateSectionSize(emptyDir, mockSectionStats);

    // Assert
    t.is(mockSectionStats.addedBytes, 0);
});

test('calculateSectionSize() - should handle non-existent directory gracefully', async (t) => {
    // Arrange
    const nonExistentDir = path.join(t.context.testDir, 'non-existent-section');

    const mockSectionStats = {
        addedBytes: 0,
        addCachedBytes(bytes) {
            this.addedBytes += bytes;
        },
    };

    // Act
    await calculateSectionSize(nonExistentDir, mockSectionStats);

    // Assert
    t.is(mockSectionStats.addedBytes, 0);
});

test('calculateSectionSize() - should pass log function to getDirectorySize', async (t) => {
    // Arrange
    const sectionDir = path.join(t.context.testDir, 'section-with-log');
    await fs.mkdir(sectionDir, { recursive: true });

    const filePath = path.join(sectionDir, 'test.txt');
    const content = 'Test content';
    await fs.writeFile(filePath, content);

    const logMessages = [];
    const logFn = (message) => logMessages.push(message);

    const mockSectionStats = {
        addedBytes: 0,
        addCachedBytes(bytes) {
            this.addedBytes += bytes;
        },
    };

    // Act
    await calculateSectionSize(sectionDir, mockSectionStats, logFn);

    // Assert
    t.is(mockSectionStats.addedBytes, Buffer.byteLength(content));
    // No error messages should be logged for successful operation
    t.is(logMessages.length, 0);
});

test('ensureDir() - should create directory if it does not exist', async (t) => {
    // Arrange
    const newDir = path.join(t.context.testDir, 'new-directory');

    // Verify directory doesn't exist
    await t.throwsAsync(async () => await fs.access(newDir));

    // Act
    await ensureDir(newDir);

    // Assert
    await fs.access(newDir); // Should not throw
    const stats = await fs.stat(newDir);
    t.true(stats.isDirectory());
});

test('ensureDir() - should not throw if directory already exists', async (t) => {
    // Arrange
    const existingDir = path.join(t.context.testDir, 'existing-directory');
    await fs.mkdir(existingDir, { recursive: true });

    // Act & Assert
    await t.notThrowsAsync(async () => await ensureDir(existingDir));

    // Verify it's still a directory
    const stats = await fs.stat(existingDir);
    t.true(stats.isDirectory());
});

test('ensureDir() - should create nested directories', async (t) => {
    // Arrange
    const nestedDir = path.join(t.context.testDir, 'level1', 'level2', 'level3');

    // Verify directory doesn't exist
    await t.throwsAsync(async () => await fs.access(nestedDir));

    // Act
    await ensureDir(nestedDir);

    // Assert
    await fs.access(nestedDir); // Should not throw
    const stats = await fs.stat(nestedDir);
    t.true(stats.isDirectory());

    // Also verify parent directories were created
    const level1Dir = path.join(t.context.testDir, 'level1');
    const level2Dir = path.join(t.context.testDir, 'level1', 'level2');

    const level1Stats = await fs.stat(level1Dir);
    const level2Stats = await fs.stat(level2Dir);

    t.true(level1Stats.isDirectory());
    t.true(level2Stats.isDirectory());
});
