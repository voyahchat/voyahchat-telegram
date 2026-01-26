const test = require('ava');
const fs = require('fs').promises;
const path = require('path');
const { TestDir } = require('./helpers/test-dir');
const {
    getExternalLinksStats,
    scrapeExternalLinks,
    formatLinksInfo,
} = require('../lib/download-links');
const { SCRAPER_DIRS, BYTES_PER_MB } = require('../lib/constants');

test.beforeEach(async (t) => {
    // Create test directory
    const dir = new TestDir();
    t.context.dir = dir;
    t.context.testDir = dir.getDownloaded();
});

test('getExternalLinksStats() - should return zero stats for non-existent directory', async (t) => {
    // Arrange
    const nonExistentDir = path.join(t.context.testDir, 'non-existent');

    // Act
    const stats = await getExternalLinksStats(nonExistentDir);

    // Assert
    t.is(stats.totalLinks, 0);
    t.is(stats.downloadedLinks, 0);
    t.is(stats.skippedLinks, 0);
    t.is(stats.totalSize, 0);
    t.is(stats.messagesWithLinks, 0);
});

test('getExternalLinksStats() - should return zero stats for empty links directory', async (t) => {
    // Arrange
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links);
    await fs.mkdir(linksDir, { recursive: true });

    // Act
    const stats = await getExternalLinksStats(t.context.testDir);

    // Assert
    t.is(stats.totalLinks, 0);
    t.is(stats.downloadedLinks, 0);
    t.is(stats.skippedLinks, 0);
    t.is(stats.totalSize, 0);
    t.is(stats.messagesWithLinks, 0);
});

test('getExternalLinksStats() - should count links and calculate size correctly', async (t) => {
    // Arrange
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links);
    const messageDir = path.join(linksDir, '123');
    await fs.mkdir(messageDir, { recursive: true });

    const file1Path = path.join(messageDir, 'page1.html');
    const file2Path = path.join(messageDir, 'page2.html');
    const cachePath = path.join(linksDir, 'scraper-cache.json');

    const content1 = '<html><body>Page 1 content</body></html>';
    const content2 = '<html><body>Page 2 content with more text</body></html>';
    const cacheContent = JSON.stringify({
        'https://example.com/page1': { timestamp: Date.now() },
        'https://example.com/page2': { timestamp: Date.now() },
    });

    await fs.writeFile(file1Path, content1);
    await fs.writeFile(file2Path, content2);
    await fs.writeFile(cachePath, cacheContent);

    // Act
    const stats = await getExternalLinksStats(t.context.testDir);

    // Assert
    t.is(stats.totalLinks, 2);
    t.is(stats.downloadedLinks, 2);
    t.is(stats.skippedLinks, 0);
    t.is(stats.totalSize, Buffer.byteLength(content1) + Buffer.byteLength(content2));
    t.is(stats.messagesWithLinks, 1);
});

test('getExternalLinksStats() - should handle multiple message directories', async (t) => {
    // Arrange
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links);
    const messageDir1 = path.join(linksDir, '123');
    const messageDir2 = path.join(linksDir, '456');
    const messageDir3 = path.join(linksDir, '789'); // Empty directory

    await fs.mkdir(messageDir1, { recursive: true });
    await fs.mkdir(messageDir2, { recursive: true });
    await fs.mkdir(messageDir3, { recursive: true });

    const file1Path = path.join(messageDir1, 'page1.html');
    const file2Path = path.join(messageDir2, 'page2.html');
    const cachePath = path.join(linksDir, 'scraper-cache.json');

    const content1 = '<html><body>Page 1 content</body></html>';
    const content2 = '<html><body>Page 2 content</body></html>';
    const cacheContent = JSON.stringify({
        'https://example.com/page1': { timestamp: Date.now() },
    });

    await fs.writeFile(file1Path, content1);
    await fs.writeFile(file2Path, content2);
    await fs.writeFile(cachePath, cacheContent);

    // Act
    const stats = await getExternalLinksStats(t.context.testDir);

    // Assert
    t.is(stats.totalLinks, 2);
    t.is(stats.downloadedLinks, 1);
    t.is(stats.skippedLinks, 1);
    t.is(stats.totalSize, Buffer.byteLength(content1) + Buffer.byteLength(content2));
    t.is(stats.messagesWithLinks, 2);
});

test('getExternalLinksStats() - should ignore scraper-cache.json file in message directories', async (t) => {
    // Arrange
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links);
    const messageDir = path.join(linksDir, '123');
    await fs.mkdir(messageDir, { recursive: true });

    const filePath = path.join(messageDir, 'page.html');
    const cachePath = path.join(messageDir, 'scraper-cache.json');

    const content = '<html><body>Page content</body></html>';
    const cacheContent = JSON.stringify({ some: 'data' });

    await fs.writeFile(filePath, content);
    await fs.writeFile(cachePath, cacheContent);

    // Act
    const stats = await getExternalLinksStats(t.context.testDir);

    // Assert
    t.is(stats.totalLinks, 1);
    t.is(stats.downloadedLinks, 1);
    t.is(stats.skippedLinks, 0);
    t.is(stats.totalSize, Buffer.byteLength(content));
    t.is(stats.messagesWithLinks, 1);
});

test('getExternalLinksStats() - should handle missing cache file', async (t) => {
    // Arrange
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links);
    const messageDir = path.join(linksDir, '123');
    await fs.mkdir(messageDir, { recursive: true });

    const filePath = path.join(messageDir, 'page.html');
    const content = '<html><body>Page content</body></html>';

    await fs.writeFile(filePath, content);

    // Act
    const stats = await getExternalLinksStats(t.context.testDir);

    // Assert
    t.is(stats.totalLinks, 1);
    t.is(stats.downloadedLinks, 1); // Should assume all were downloaded
    t.is(stats.skippedLinks, 0);
    t.is(stats.totalSize, Buffer.byteLength(content));
    t.is(stats.messagesWithLinks, 1);
});

test('scrapeExternalLinks() - should return early when no external URLs found', async (t) => {
    // Arrange
    const mockScraper = {
        extractExternalUrls: () => [],
    };
    const mockMessageJson = { text: 'No links here' };
    const mockLog = () => {};

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    // If we get here without errors, the function returned early as expected
    t.pass();
});

test('scrapeExternalLinks() - should process external URLs', async (t) => {
    // Arrange
    const urls = ['https://example.com/page1', 'https://example.com/page2'];
    const mockScraper = {
        extractExternalUrls: () => urls,
        downloadPage: async (url, dir) => {
            // Create the directory if it doesn't exist
            await fs.mkdir(dir, { recursive: true });
            const filename = url.split('/').pop() + '.html';
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, `<html><body>Content from ${url}</body></html>`);
            return { success: true };
        },
    };
    const mockMessageJson = { text: 'Check out https://example.com/page1 and https://example.com/page2' };
    const logMessages = [];
    const mockLog = (message) => logMessages.push(message);

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    t.true(logMessages.some(msg => msg.includes('Found 2 external link(s)')), 'Should log found links count');
    t.true(logMessages.some(msg => msg.includes('Downloaded https://example.com/page1')), 'Should log first download');
    t.true(logMessages.some(msg => msg.includes('Downloaded https://example.com/page2')), 'Should log second download');

    // Verify files were created
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links, '123');
    const files = await fs.readdir(linksDir);
    t.is(files.length, 2);
    t.true(files.includes('page1.html'), 'Should contain page1.html');
    t.true(files.includes('page2.html'), 'Should contain page2.html');
});

test('scrapeExternalLinks() - should handle skipped URLs', async (t) => {
    // Arrange
    const urls = ['https://example.com/skip'];
    const mockScraper = {
        extractExternalUrls: () => urls,
        downloadPage: async () => ({ skipped: true, reason: 'Already downloaded' }),
    };
    const mockMessageJson = { text: 'Check out https://example.com/skip' };
    const logMessages = [];
    const mockLog = (message) => logMessages.push(message);

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    t.true(logMessages.some(msg => msg.includes('Found 1 external link(s)')), 'Should log found links count');
    t.true(
        logMessages.some(msg => msg.includes('Skipped https://example.com/skip: Already downloaded')),
        'Should log skip',
    );
});

test('scrapeExternalLinks() - should handle failed downloads', async (t) => {
    // Arrange
    const urls = ['https://example.com/fail'];
    const mockScraper = {
        extractExternalUrls: () => urls,
        downloadPage: async () => ({ success: false, error: 'Network error' }),
    };
    const mockMessageJson = { text: 'Check out https://example.com/fail' };
    const logMessages = [];
    const mockLog = (message) => logMessages.push(message);

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    t.true(logMessages.some(msg => msg.includes('Found 1 external link(s)')), 'Should log found links count');
    t.true(
        logMessages.some(msg => msg.includes('Failed to download https://example.com/fail: Network error')),
        'Should log failure',
    );
});

test('scrapeExternalLinks() - should handle exceptions during scraping', async (t) => {
    // Arrange
    const urls = ['https://example.com/error'];
    const mockScraper = {
        extractExternalUrls: () => urls,
        downloadPage: async () => {
            throw new Error('Scraping error');
        },
    };
    const mockMessageJson = { text: 'Check out https://example.com/error' };
    const logMessages = [];
    const mockLog = (message) => logMessages.push(message);

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    t.true(logMessages.some(msg => msg.includes('Found 1 external link(s)')), 'Should log found links count');
    t.true(
        logMessages.some(msg => msg.includes('Error scraping https://example.com/error: Scraping error')),
        'Should log error',
    );
});

test('scrapeExternalLinks() - should handle URLs with special characters', async (t) => {
    // Arrange
    const urls = ['https://example.com/search?q=test&filter=recent'];
    const mockScraper = {
        extractExternalUrls: () => urls,
        downloadPage: async (url, dir) => {
            // Create the directory if it doesn't exist
            await fs.mkdir(dir, { recursive: true });
            const filename = 'search.html';
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, `<html><body>Content from ${url}</body></html>`);
            return { success: true };
        },
    };
    const mockMessageJson = { text: 'Check out https://example.com/search?q=test&filter=recent' };
    const logMessages = [];
    const mockLog = (message) => logMessages.push(message);

    // Act
    await scrapeExternalLinks({
        scraper: mockScraper,
        messageJson: mockMessageJson,
        baseDir: t.context.testDir,
        messageId: 123,
        log: mockLog,
    });

    // Assert
    t.true(logMessages.some(msg => msg.includes('Found 1 external link(s)')), 'Should log found links count');
    t.true(
        logMessages.some(msg => msg.includes('Downloaded https://example.com/search?q=test&filter=recent')),
        'Should log special chars',
    );

    // Verify files were created
    const linksDir = path.join(t.context.testDir, SCRAPER_DIRS.links, '123');
    const files = await fs.readdir(linksDir);
    t.is(files.length, 1);
    t.true(files.includes('search.html'), 'Should contain search.html');
});

test('formatLinksInfo() - should return empty array for zero links', (t) => {
    // Arrange
    const linksStats = {
        totalLinks: 0,
        downloadedLinks: 0,
        skippedLinks: 0,
        totalSize: 0,
        messagesWithLinks: 0,
    };

    // Act
    const result = formatLinksInfo(linksStats);

    // Assert
    t.deepEqual(result, []);
});

test('formatLinksInfo() - should format links count and size', (t) => {
    // Arrange
    const linksStats = {
        totalLinks: 5,
        downloadedLinks: 3,
        skippedLinks: 2,
        totalSize: 2.5 * BYTES_PER_MB,
        messagesWithLinks: 3,
    };

    // Act
    const result = formatLinksInfo(linksStats);

    // Assert
    t.deepEqual(result, ['5 links', '2.5Mb']);
});

test('formatLinksInfo() - should format links count without size when no downloaded links', (t) => {
    // Arrange
    const linksStats = {
        totalLinks: 5,
        downloadedLinks: 0,
        skippedLinks: 5,
        totalSize: 0,
        messagesWithLinks: 3,
    };

    // Act
    const result = formatLinksInfo(linksStats);

    // Assert
    t.deepEqual(result, ['5 links']);
});

test('formatLinksInfo() - should format size with one decimal place', (t) => {
    // Arrange
    const linksStats = {
        totalLinks: 1,
        downloadedLinks: 1,
        skippedLinks: 0,
        totalSize: 1234567, // ~1.2MB
        messagesWithLinks: 1,
    };

    // Act
    const result = formatLinksInfo(linksStats);

    // Assert
    t.deepEqual(result, ['1 links', '1.2Mb']);
});

