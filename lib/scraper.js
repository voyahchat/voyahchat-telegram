const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

/**
 * Cache metadata file name
 */
const CACHE_FILE = 'scraper-cache.json';

/**
 * Web scraper for downloading external pages and images using wget
 * Uses Last-Modified headers to avoid re-downloading unchanged content
 *
 * @module telegram/scraper
 */
class WebScraper {
    /**
     * Create a new web scraper
     * @param {Object} options - Scraper options
     * @param {string} [options.outputDir='telegram'] - Base output directory
     * @param {boolean} [options.verbose=false] - Enable verbose logging
     * @param {Object} [options.logger] - Logger instance
     * @param {number} [options.timeout=30] - Download timeout in seconds
     * @param {number} [options.retries=2] - Number of download retries
     */
    constructor(options = {}) {
        this.outputDir = options.outputDir || 'telegram';
        this.verbose = options.verbose || false;
        this.logger = options.logger;
        this.timeout = options.timeout || 30;
        this.retries = options.retries || 2;
        this.cache = new Map();
    }

    /**
     * Load cache from disk
     * @param {string} cacheDir - Directory containing cache file
     * @returns {Promise<void>}
     */
    async loadCache(cacheDir) {
        const cachePath = path.join(cacheDir, CACHE_FILE);
        try {
            const content = await fs.readFile(cachePath, 'utf8');
            const data = JSON.parse(content);
            this.cache = new Map(Object.entries(data));
            this.log(`Loaded scraper cache with ${this.cache.size} entries`);
        } catch {
            this.cache = new Map();
        }
    }

    /**
     * Save cache to disk
     * @param {string} cacheDir - Directory to save cache file
     * @returns {Promise<void>}
     */
    async saveCache(cacheDir) {
        await fs.mkdir(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, CACHE_FILE);
        const data = Object.fromEntries(this.cache);
        await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
    }

    /**
     * Extract external URLs from message text
     * Excludes t.me links which are handled separately by Telegram downloader
     * @param {string} text - Message text to parse
     * @returns {string[]} Array of unique external URLs
     */
    extractExternalUrls(text) {
        if (!text) return [];

        // Match http/https URLs, exclude t.me
        const urlRegex = /https?:\/\/(?!t\.me)[^\s<>"'\])+]+/gi;
        const matches = text.match(urlRegex) || [];

        // Clean up trailing punctuation and deduplicate
        const cleaned = matches.map(url => url.replace(/[.,;:!?)]+$/, ''));
        return [...new Set(cleaned)];
    }

    /**
     * Check if URL needs to be re-downloaded using HEAD request
     * Compares Last-Modified and ETag headers with cached values
     * @param {string} url - URL to check
     * @returns {Promise<Object>} Result with needsDownload, lastModified, etag
     */
    async checkIfModified(url) {
        const cached = this.cache.get(url);
        if (!cached) {
            return { needsDownload: true, lastModified: null, etag: null };
        }

        try {
            // Use curl to get headers (more reliable than wget for HEAD)
            const curlResult = spawnSync('curl', [
                '-sI',
                '--max-time', '10',
                url,
            ], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            if (curlResult.status !== 0) {
                throw new Error(`curl failed with status ${curlResult.status}`);
            }

            // Use grep to filter headers
            const grepResult = spawnSync('grep', [
                '-i',
                'last-modified\\|etag',
            ], {
                encoding: 'utf8',
                input: curlResult.stdout,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const result = grepResult.stdout;

            const lastModifiedMatch = result.match(/last-modified:\s*(.+)/i);
            const etagMatch = result.match(/etag:\s*(.+)/i);

            const lastModified = lastModifiedMatch ? lastModifiedMatch[1].trim() : null;
            const etag = etagMatch ? etagMatch[1].trim() : null;

            // Compare with cached values
            if (cached.lastModified && lastModified === cached.lastModified) {
                this.log(`  URL not modified (Last-Modified match): ${url}`);
                return { needsDownload: false, lastModified, etag };
            }
            if (cached.etag && etag === cached.etag) {
                this.log(`  URL not modified (ETag match): ${url}`);
                return { needsDownload: false, lastModified, etag };
            }

            return { needsDownload: true, lastModified, etag };
        } catch {
            // If HEAD request fails, download anyway
            return { needsDownload: true, lastModified: null, etag: null };
        }
    }

    /**
     * Download page with images using wget
     * Checks Last-Modified header to skip unchanged content
     * @param {string} url - URL to download
     * @param {string} outputDir - Directory to save content
     * @returns {Promise<Object>} Download result with success, skipped, localPath
     */
    async downloadPage(url, outputDir) {
        // Check if content has changed
        const { needsDownload, lastModified, etag } = await this.checkIfModified(url);

        if (!needsDownload) {
            return {
                url,
                localPath: outputDir,
                success: true,
                skipped: true,
                reason: 'Not modified since last download',
                scrapedAt: this.cache.get(url)?.scrapedAt,
            };
        }

        await fs.mkdir(outputDir, { recursive: true });

        const wgetArgs = [
            '--quiet',
            '--page-requisites',
            '--convert-links',
            '--adjust-extension',
            '--span-hosts',
            '--no-parent',
            `--directory-prefix=${outputDir}`,
            `--timeout=${this.timeout}`,
            `--tries=${this.retries}`,
            '--no-check-certificate',
            url,
        ];

        try {
            // Use spawnSync instead of execSync to prevent shell injection
            const result = spawnSync('wget', wgetArgs, {
                stdio: this.verbose ? 'inherit' : 'pipe',
                timeout: (this.timeout + 10) * 1000,
            });

            if (result.status !== 0) {
                throw new Error(`wget failed with status ${result.status}`);
            }

            // Update cache with new Last-Modified/ETag
            const scrapedAt = new Date().toISOString();
            this.cache.set(url, { lastModified, etag, scrapedAt });

            return {
                url,
                localPath: outputDir,
                success: true,
                skipped: false,
                scrapedAt,
            };
        } catch (err) {
            return {
                url,
                localPath: outputDir,
                success: false,
                error: err.message,
                scrapedAt: new Date().toISOString(),
            };
        }
    }

    /**
     * Log message using logger or console
     * @param {...any} args - Arguments to log
     */
    log(...args) {
        if (this.logger) {
            this.logger.debug(...args);
        } else if (this.verbose) {
            console.log(...args);
        }
    }
}

module.exports = { WebScraper, CACHE_FILE };
