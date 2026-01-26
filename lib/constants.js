/**
 * Telegram Module Constants
 * Centralized constants used across telegram scripts for downloading and processing content.
 *
 * @module telegram/constants
 */

/**
 * Number of bytes in one megabyte.
 * Used for size calculations and conversions throughout the application.
 *
 * @constant {number}
 * @default 1048576
 */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Minimum file size in bytes to trigger download progress display.
 * Files larger than this threshold will show progress indicators during download.
 *
 * @constant {number}
 * @default 10485760
 */
const PROGRESS_THRESHOLD_BYTES = 10 * BYTES_PER_MB;

/**
 * Default configuration values for download operations.
 * Contains retry logic, timeout settings, and rate limiting parameters.
 *
 * @constant {Object}
 * @property {number} maxRetries - Maximum number of retry attempts for failed downloads
 * @property {number} retryDelayBaseMs - Base delay in milliseconds between retries
 * @property {number} retryDelayMaxMs - Maximum delay in milliseconds between retries
 * @property {number} retryJitterMs - Random jitter in milliseconds to prevent retry synchronization
 * @property {number} timeoutBaseMs - Base timeout in milliseconds for downloads
 * @property {number} timeoutPerMbMs - Additional timeout in milliseconds per megabyte of file size
 * @property {number} timeoutMaxMs - Maximum timeout in milliseconds for any download
 * @property {number} connectionRetries - Maximum number of connection retry attempts
 * @property {number} connectionTimeoutMs - Timeout in milliseconds for establishing connections
 * @property {number} messagesPerRequest - Number of messages to fetch per API request
 * @property {number} rateLimitDelayMs - Delay in milliseconds between requests to respect rate limits
 */
const DEFAULT_DOWNLOAD_CONFIG = {
    maxRetries: 10,
    retryDelayBaseMs: 2000,
    retryDelayMaxMs: 60000,
    retryJitterMs: 1000,
    timeoutBaseMs: 60000,
    timeoutPerMbMs: 30000,
    timeoutMaxMs: 600000,
    connectionRetries: 5,
    connectionTimeoutMs: 30000,
    messagesPerRequest: 100,
    rateLimitDelayMs: 1000,
};

/**
 * File extensions used for different media types when saving downloaded content.
 * Maps Telegram media types to appropriate file extensions.
 *
 * @constant {Object}
 * @property {string} PHOTO - File extension for photo files
 * @property {string} VIDEO - File extension for video files
 * @property {string} AUDIO - File extension for audio files
 * @property {string} DEFAULT - Default extension for unrecognized media types
 */
const MEDIA_EXTENSIONS = {
    PHOTO: 'jpg',
    VIDEO: 'mp4',
    AUDIO: 'mp3',
    DEFAULT: 'bin',
};

/**
 * Directory structure for organizing downloaded content.
 * Defines the folder hierarchy used in the output directory.
 *
 * @constant {Object}
 * @property {string} sections - Directory for main content sections
 * @property {string} additional - Directory for additional content
 * @property {string} referenced - Directory for referenced content
 * @property {string} media - Directory for media files
 */
const OUTPUT_DIRS = {
    sections: 'sections',
    additional: 'additional',
    referenced: 'referenced',
    media: 'media',
};

/**
 * Standard file names used for various output files.
 * Ensures consistent naming across the application.
 *
 * @constant {Object}
 * @property {string} index - Name of the main index file
 * @property {string} metadata - Name of the metadata file
 * @property {string} pinned - Name of the pinned messages file
 */
const OUTPUT_FILES = {
    index: 'index.json',
    metadata: 'metadata.json',
    pinned: 'pinned.json',
};

/**
 * Directory structure for scraper-specific output.
 * Defines folders used by the web scraper component.
 *
 * @constant {Object}
 * @property {string} links - Directory for storing scraped links
 */
const SCRAPER_DIRS = {
    links: 'links',
};

module.exports = {
    BYTES_PER_MB,
    DEFAULT_DOWNLOAD_CONFIG,
    MEDIA_EXTENSIONS,
    OUTPUT_DIRS,
    OUTPUT_FILES,
    PROGRESS_THRESHOLD_BYTES,
    SCRAPER_DIRS,
};

