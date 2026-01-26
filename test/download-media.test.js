const test = require('ava');
const fs = require('fs').promises;
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const {
    downloadMedia,
    processMessageMedia,
    getMediaExtension,
    getEstimatedFileSize,
    createMediaFileInfo,
} = require('../lib/download-media');
const {
    MEDIA_EXTENSIONS,
    OUTPUT_DIRS,
    PROGRESS_THRESHOLD_BYTES,
} = require('../lib/constants');

test.beforeEach(async (t) => {
    // Create test directory
    const dir = new TestDir();
    t.context.dir = dir;
    t.context.testDir = dir.getDownloaded();
    t.context.sectionDir = path.join(t.context.testDir, 'test-section');

    // Create section directory
    await fs.mkdir(t.context.sectionDir, { recursive: true });

    // Mock stats object
    t.context.stats = {
        mediaStats: { downloaded: 0, skipped: 0, failed: 0 },
        errors: [],
        incrementMedia(type, bytes = 0) {
            this.mediaStats[type]++;
            if (bytes) {
                this.mediaStats[`${type}Bytes`] = (this.mediaStats[`${type}Bytes`] || 0) + bytes;
            }
        },
        addError(error, type, context = {}) {
            this.errors.push({ error, type, context });
        },
    };

    // Mock section stats object
    t.context.sectionStats = {
        cachedBytes: 0,
        newBytes: 0,
        addCachedBytes(bytes) {
            this.cachedBytes += bytes;
        },
        addNewBytes(bytes) {
            this.newBytes += bytes;
        },
    };

    // Mock download config
    t.context.downloadConfig = {
        maxRetries: 3,
        retryDelayBaseMs: 10,
        retryDelayMaxMs: 100,
        retryJitterMs: 5,
        timeoutBaseMs: 100,
        timeoutPerMbMs: 50,
        timeoutMaxMs: 500,
    };

    // Mock log function
    t.context.logMessages = [];
    t.context.logFn = (message) => t.context.logMessages.push(message);
});

test('getMediaExtension() - should return jpg for photo messages', (t) => {
    // Arrange
    const message = {
        photo: { sizes: [] },
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, MEDIA_EXTENSIONS.PHOTO);
});

test('getMediaExtension() - should return mp4 for video messages', (t) => {
    // Arrange
    const message = {
        video: { size: 1000000 },
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, MEDIA_EXTENSIONS.VIDEO);
});

test('getMediaExtension() - should return mp3 for audio messages', (t) => {
    // Arrange
    const message = {
        audio: { size: 500000 },
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, MEDIA_EXTENSIONS.AUDIO);
});

test('getMediaExtension() - should return document extension for document messages', (t) => {
    // Arrange
    const message = {
        document: { fileName: 'document.pdf' },
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, 'pdf');
});

test('getMediaExtension() - should return default extension for document without extension', (t) => {
    // Arrange
    const message = {
        document: { fileName: 'document' },
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, MEDIA_EXTENSIONS.DEFAULT);
});

test('getMediaExtension() - should return default extension for unknown message type', (t) => {
    // Arrange
    const message = {
        id: 123,
    };

    // Act
    const extension = getMediaExtension(message);

    // Assert
    t.is(extension, MEDIA_EXTENSIONS.DEFAULT);
});

test('getEstimatedFileSize() - should return document size for document messages', (t) => {
    // Arrange
    const message = {
        document: { size: 5000000 },
        id: 123,
    };

    // Act
    const size = getEstimatedFileSize(message);

    // Assert
    t.is(size, 5000000);
});

test('getEstimatedFileSize() - should return video size for video messages', (t) => {
    // Arrange
    const message = {
        video: { size: 10000000 },
        id: 123,
    };

    // Act
    const size = getEstimatedFileSize(message);

    // Assert
    t.is(size, 10000000);
});

test('getEstimatedFileSize() - should return largest photo size for photo messages', (t) => {
    // Arrange
    const message = {
        photo: {
            sizes: [
                { size: 10000 },
                { size: 50000 },
                { size: 20000 },
            ],
        },
        id: 123,
    };

    // Act
    const size = getEstimatedFileSize(message);

    // Assert
    t.is(size, 50000);
});

test('getEstimatedFileSize() - should return 0 for photo messages without sizes', (t) => {
    // Arrange
    const message = {
        photo: { sizes: [] },
        id: 123,
    };

    // Act
    const size = getEstimatedFileSize(message);

    // Assert
    t.is(size, 0);
});

test('getEstimatedFileSize() - should return 0 for messages without media', (t) => {
    // Arrange
    const message = {
        id: 123,
    };

    // Act
    const size = getEstimatedFileSize(message);

    // Assert
    t.is(size, 0);
});

test('createMediaFileInfo() - should create media file info object', (t) => {
    // Arrange
    const message = {
        id: 123,
        media: { className: 'MessageMediaPhoto' },
    };
    const fileName = '123.jpg';
    const filePath = path.join(t.context.sectionDir, 'media', fileName);

    // Act
    const fileInfo = createMediaFileInfo(message, fileName, filePath, t.context.sectionDir);

    // Assert
    t.is(fileInfo.type, 'photo');
    t.is(fileInfo.fileId, 123);
    t.is(fileInfo.fileName, fileName);
    t.is(fileInfo.localPath, path.join('media', fileName));
});

test('downloadMedia() - should return empty array for messages without media', async (t) => {
    // Arrange
    const message = { id: 123 };
    const mockClient = {};

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
});

test('downloadMedia() - should skip download if media file already exists', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const mockClient = {};

    // Create media directory and file
    const mediaDir = path.join(t.context.sectionDir, OUTPUT_DIRS.media);
    await fs.mkdir(mediaDir, { recursive: true });

    const fileName = '123.jpg';
    const filePath = path.join(mediaDir, fileName);
    await fs.writeFile(filePath, Buffer.from('existing file content'));

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.is(result.length, 1);
    t.is(result[0].fileId, 123);
    t.is(result[0].fileName, fileName);
    t.is(t.context.stats.mediaStats.skipped, 1);
    t.is(t.context.sectionStats.cachedBytes, 21); // Length of "existing file content"
    t.true(t.context.logMessages.some(msg => msg.includes('Media already exists')));
});

test('downloadMedia() - should handle "not implemented" errors gracefully', async (t) => {
    // Arrange
    const message = {
        id: 123,
        media: { className: 'MessageMediaUnsupported' },
    };

    const mockClient = {
        downloadMedia: () => Promise.reject(new Error('not implemented')),
    };

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
    t.is(t.context.stats.mediaStats.skipped, 1);
    t.true(t.context.logMessages.some(msg => msg.includes('Media type not supported')));
});

test('downloadMedia() - should handle download failures', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const mockClient = {
        downloadMedia: () => Promise.reject(new Error('Download failed')),
    };

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
    t.is(t.context.stats.mediaStats.failed, 1);
    t.is(t.context.stats.errors.length, 1);
    t.is(t.context.stats.errors[0].type, 'media-download');
    t.true(t.context.logMessages.some(msg => msg.includes('Failed to download media')));
});

test('downloadMedia() - should handle invalid URL/validation errors', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const mockClient = {
        downloadMedia: () => Promise.reject(new Error('Invalid URL provided')),
    };

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
    t.is(t.context.stats.mediaStats.failed, 1);
    t.is(t.context.stats.errors.length, 1);
    t.is(t.context.stats.errors[0].type, 'media-download');
    t.true(t.context.logMessages.some(msg => msg.includes('Failed to download media')));
});

test('downloadMedia() - should handle network errors', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const mockClient = {
        downloadMedia: () => Promise.reject(new Error('Network error: ECONNRESET')),
    };

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
    t.is(t.context.stats.mediaStats.failed, 1);
    t.is(t.context.stats.errors.length, 1);
    t.is(t.context.stats.errors[0].type, 'media-download');
    t.true(t.context.logMessages.some(msg => msg.includes('Failed to download media')));
});

test('downloadMedia() - should handle file system errors during write', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const fileContent = Buffer.from('downloaded media content');
    const mockClient = {
        downloadMedia: () => Promise.resolve(fileContent),
    };

    // Create a test directory that we can make read-only to simulate a file system error
    const testMediaDir = path.join(t.context.sectionDir, OUTPUT_DIRS.media);
    await fs.mkdir(testMediaDir, { recursive: true });

    // Make the directory read-only to cause a write error
    try {
        await fs.chmod(testMediaDir, 0o444); // Read-only
    } catch (err) {
        // If we can't change permissions, skip this test
        t.pass('Skipping test - cannot change directory permissions');
        return;
    }

    try {
        // Act
        const result = await downloadMedia(
            mockClient,
            message,
            t.context.sectionDir,
            t.context.downloadConfig,
            t.context.stats,
            t.context.sectionStats,
            t.context.logFn,
        );

        // Assert
        t.deepEqual(result, []);
        t.is(t.context.stats.mediaStats.failed, 1);
        t.is(t.context.stats.errors.length, 1);
        t.is(t.context.stats.errors[0].type, 'media-download');
        t.true(t.context.logMessages.some(msg => msg.includes('Failed to save media')));
    } finally {
        // Restore directory permissions for cleanup
        try {
            await fs.chmod(testMediaDir, 0o755); // Read/write
        } catch (err) {
            // Ignore errors during cleanup
        }
    }
});

test('downloadMedia() - should download media successfully', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const fileContent = Buffer.from('downloaded media content');
    const mockClient = {
        downloadMedia: () => Promise.resolve(fileContent),
    };

    // Act
    const result = await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.is(result.length, 1);
    t.is(result[0].fileId, 123);
    t.is(result[0].fileName, '123.jpg');
    t.is(t.context.stats.mediaStats.downloaded, 1);
    t.is(t.context.sectionStats.newBytes, fileContent.length);
    t.true(t.context.logMessages.some(msg => msg.includes('Downloading media')));
    t.true(t.context.logMessages.some(msg => msg.includes('Media saved')));

    // Verify file was created
    const filePath = path.join(t.context.sectionDir, OUTPUT_DIRS.media, '123.jpg');
    const savedContent = await fs.readFile(filePath);
    t.deepEqual(savedContent, fileContent);
});

test('downloadMedia() - should show progress for large files', async (t) => {
    // Arrange
    const fileSize = PROGRESS_THRESHOLD_BYTES + 1000000; // Larger than threshold
    const message = {
        id: 123,
        video: { size: fileSize },
        media: { className: 'MessageMediaVideo' },
    };

    const fileContent = Buffer.alloc(fileSize, 'x');

    const mockClient = {
        downloadMedia: (msg, options) => {
            if (options.progressCallback) {
                // Simulate progress events
                options.progressCallback(fileSize * 0.25);
                options.progressCallback(fileSize * 0.5);
                options.progressCallback(fileSize * 0.75);
                options.progressCallback(fileSize);
            }
            return Promise.resolve(fileContent);
        },
    };

    // Act
    await downloadMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.true(t.context.logMessages.some(msg => msg.includes('Download progress: 25%')));
    t.true(t.context.logMessages.some(msg => msg.includes('Download progress: 50%')));
    t.true(t.context.logMessages.some(msg => msg.includes('Download progress: 75%')));
});

test('processMessageMedia() - should return empty array for messages without media', async (t) => {
    // Arrange
    const message = { id: 123 };
    const mockClient = {};

    // Act
    const result = await processMessageMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.deepEqual(result, []);
});

test('processMessageMedia() - should call downloadMedia for messages with media', async (t) => {
    // Arrange
    const message = {
        id: 123,
        photo: { sizes: [{ size: 50000 }] },
        media: { className: 'MessageMediaPhoto' },
    };

    const fileContent = Buffer.from('downloaded media content');
    const mockClient = {
        downloadMedia: () => Promise.resolve(fileContent),
    };

    // Act
    const result = await processMessageMedia(
        mockClient,
        message,
        t.context.sectionDir,
        t.context.downloadConfig,
        t.context.stats,
        t.context.sectionStats,
        t.context.logFn,
    );

    // Assert
    t.is(result.length, 1);
    t.is(result[0].fileId, 123);
    t.is(t.context.stats.mediaStats.downloaded, 1);
    t.is(t.context.sectionStats.newBytes, fileContent.length);
});
