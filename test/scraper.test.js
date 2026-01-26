const test = require('ava');
const path = require('path');
const fsPromises = require('fs').promises;
const { WebScraper, CACHE_FILE } = require('../lib/scraper');
const { TestDir } = require('./helpers/test-dir');

test('WebScraper.extractExternalUrls() - should extract URLs from text', (t) => {
    const scraper = new WebScraper();

    // Basic URL extraction
    const text1 = 'Check out https://drive2.ru/article/123 for details';
    const urls1 = scraper.extractExternalUrls(text1);
    t.deepEqual(urls1, ['https://drive2.ru/article/123']);

    // Multiple URLs
    const text2 = 'See https://example.com and https://test.org/page';
    const urls2 = scraper.extractExternalUrls(text2);
    t.deepEqual(urls2, ['https://example.com', 'https://test.org/page']);

    // Should exclude t.me links
    const text3 = 'Telegram https://t.me/channel/123 and https://drive2.ru/test';
    const urls3 = scraper.extractExternalUrls(text3);
    t.deepEqual(urls3, ['https://drive2.ru/test']);

    // Should handle trailing punctuation
    const text4 = 'Link: https://example.com/page. And more!';
    const urls4 = scraper.extractExternalUrls(text4);
    t.deepEqual(urls4, ['https://example.com/page']);

    // Should deduplicate
    const text5 = 'Same https://example.com and https://example.com again';
    const urls5 = scraper.extractExternalUrls(text5);
    t.deepEqual(urls5, ['https://example.com']);
});

test('WebScraper.extractExternalUrls() - should handle URLs with special characters', (t) => {
    const scraper = new WebScraper();

    // URL with query parameters
    const text1 = 'Check https://example.com/search?q=test&filter=recent for results';
    const urls1 = scraper.extractExternalUrls(text1);
    t.deepEqual(urls1, ['https://example.com/search?q=test&filter=recent']);

    // URL with hash fragment
    const text2 = 'See https://example.com/page#section1 for details';
    const urls2 = scraper.extractExternalUrls(text2);
    t.deepEqual(urls2, ['https://example.com/page#section1']);

    // URL with encoded characters
    const text3 = 'Visit https://example.com/path%20with%20spaces';
    const urls3 = scraper.extractExternalUrls(text3);
    t.deepEqual(urls3, ['https://example.com/path%20with%20spaces']);

    // URL with parentheses
    const text4 = 'Link (https://example.com/page) in text';
    const urls4 = scraper.extractExternalUrls(text4);
    t.deepEqual(urls4, ['https://example.com/page']);
});

test('WebScraper.extractExternalUrls() - should handle empty input', (t) => {
    const scraper = new WebScraper();

    t.deepEqual(scraper.extractExternalUrls(''), []);
    t.deepEqual(scraper.extractExternalUrls(null), []);
    t.deepEqual(scraper.extractExternalUrls(undefined), []);
    t.deepEqual(scraper.extractExternalUrls('No URLs here'), []);
});

test('WebScraper.loadCache() - should load cache from file', async (t) => {
    const dir = new TestDir();
    const cacheDir = dir.getCache();

    // Create cache file
    const cacheData = {
        'https://example.com': {
            lastModified: 'Wed, 15 Jan 2025 12:00:00 GMT',
            etag: '"abc123"',
            scrapedAt: '2025-01-15T12:00:00Z',
        },
    };
    await fsPromises.writeFile(
        path.join(cacheDir, CACHE_FILE),
        JSON.stringify(cacheData),
    );

    const scraper = new WebScraper();
    await scraper.loadCache(cacheDir);

    t.is(scraper.cache.size, 1);
    t.deepEqual(scraper.cache.get('https://example.com'), cacheData['https://example.com']);
});

test('WebScraper.loadCache() - should handle missing cache file', async (t) => {
    const dir = new TestDir();
    const cacheDir = dir.getCache();

    const scraper = new WebScraper();
    await scraper.loadCache(cacheDir);

    t.is(scraper.cache.size, 0);
});

test('WebScraper.saveCache() - should save cache to file', async (t) => {
    const dir = new TestDir();
    const cacheDir = dir.getCache();

    const scraper = new WebScraper();
    scraper.cache.set('https://test.com', {
        lastModified: 'Thu, 16 Jan 2025 10:00:00 GMT',
        etag: '"xyz789"',
        scrapedAt: '2025-01-16T10:00:00Z',
    });

    await scraper.saveCache(cacheDir);

    const content = await fsPromises.readFile(path.join(cacheDir, CACHE_FILE), 'utf8');
    const data = JSON.parse(content);

    t.deepEqual(data['https://test.com'], {
        lastModified: 'Thu, 16 Jan 2025 10:00:00 GMT',
        etag: '"xyz789"',
        scrapedAt: '2025-01-16T10:00:00Z',
    });
});


test('WebScraper.checkIfModified() - should return needsDownload true when URL not in cache', async (t) => {
    const scraper = new WebScraper();

    // URL not in cache
    const result = await scraper.checkIfModified('https://example.com/new-page');

    t.is(result.needsDownload, true, 'Should need download when URL not in cache');
});




test('WebScraper.checkIfModified() - should return needsDownload true on curl failure', async (t) => {
    const scraper = new WebScraper();
    const url = 'https://example.com/page';

    scraper.cache.set(url, {
        lastModified: 'Wed, 15 Jan 2025 12:00:00 GMT',
        etag: '"abc123"',
        scrapedAt: '2025-01-15T12:00:00Z',
    });

    // Mock spawnSync to simulate curl failure
    const { spawnSync } = require('child_process');
    const originalSpawnSync = spawnSync;

    require('child_process').spawnSync = (command, args) => {
        if (command === 'curl') {
            return {
                status: 1, // Non-zero status indicates failure
            };
        }
        return originalSpawnSync(command, args);
    };

    const result = await scraper.checkIfModified(url);

    t.is(result.needsDownload, true, 'Should need download on curl failure');
    t.is(result.lastModified, null);
    t.is(result.etag, null);

    // Restore original spawnSync
    require('child_process').spawnSync = originalSpawnSync;
});

test('WebScraper.downloadPage() - should skip unchanged content', async (t) => {
    const dir = new TestDir();
    const scraper = new WebScraper();
    const url = 'https://example.com/page';

    // Pre-populate cache
    scraper.cache.set(url, {
        lastModified: 'Wed, 15 Jan 2025 12:00:00 GMT',
        etag: '"abc123"',
        scrapedAt: '2025-01-15T12:00:00Z',
    });

    // Mock checkIfModified to return needsDownload: false
    scraper.checkIfModified = async () => ({
        needsDownload: false,
        lastModified: 'Wed, 15 Jan 2025 12:00:00 GMT',
        etag: '"abc123"',
    });

    const result = await scraper.downloadPage(url, dir.getDownloaded());

    t.true(result.skipped);
    t.is(result.reason, 'Not modified since last download');
    t.true(result.success);
    t.is(result.url, url);
});

test('WebScraper.downloadPage() - should handle download failure', async (t) => {
    // Arrange
    const dir = new TestDir();
    const scraper = new WebScraper();
    const url = 'https://example.com/page';

    // Mock spawnSync to simulate wget failure
    const { spawnSync } = require('child_process');
    const originalSpawnSync = spawnSync;

    require('child_process').spawnSync = (command, args) => {
        if (command === 'curl') {
            // Return headers indicating content needs download
            return {
                status: 0,
                stdout: 'Last-Modified: Thu, 16 Jan 2025 12:00:00 GMT\n',
            };
        }
        if (command === 'wget') {
            // Simulate wget failure
            return {
                status: 1, // Non-zero status indicates failure
            };
        }
        if (command === 'grep') {
            return {
                status: 0,
                stdout: 'last-modified: Thu, 16 Jan 2025 12:00:00 GMT\n',
            };
        }
        return originalSpawnSync(command, args);
    };

    try {
        // Act
        const result = await scraper.downloadPage(url, dir.getDownloaded());

        // Assert
        t.false(result.success);
        t.regex(result.error, /wget failed/, 'Error message should mention wget failed');
        t.is(result.url, url);
        t.is(result.localPath, dir.getDownloaded());
    } finally {
        // Restore original spawnSync
        require('child_process').spawnSync = originalSpawnSync;
    }
});


