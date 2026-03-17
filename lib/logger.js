/**
 * Logger utility for Telegram downloader with verbose mode support
 *
 * @module telegram/logger
 */

/**
 * Status symbols for topic progress display
 */
const STATUS_SYMBOLS = {
    pending: '[ ]',
    progress: '[-]',
    complete: '[V]',
    failed: '[X]',
};

/**
 * Log level colors for console output
 */
const LOG_COLORS = {
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m',  // Green
    warn: '\x1b[33m',  // Yellow
    error: '\x1b[31m', // Red
    reset: '\x1b[0m',  // Reset
};

/**
 * Logger with verbose mode support
 */
class TelegramLogger {
    /**
     * Create a new logger
     * @param {Object} options - Logger options
     * @param {boolean} options.verbose - Enable verbose output
     * @param {boolean} options.timestamps - Enable timestamps in logs
     * @param {boolean} options.colors - Enable colored output
     */
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.timestamps = options.timestamps !== false; // Default to true
        this.colors = options.colors !== false; // Default to true
        this.topics = new Map();
        this.isTest = process.env.NODE_ENV === 'test';
        this.activeAnimations = new Map();
        this.animationIntervals = new Map();
        this.topicErrors = new Map(); // Store error reasons for failed topics
        this.topicLines = new Map(); // Track which line each topic is on
    }

    /**
     * Format message with timestamp and log level
     * @param {string} level - Log level
     * @param {Array} args - Arguments to log
     * @returns {Array} Formatted arguments
     * @private
     */
    _formatMessage(level, args) {
        const prefix = [];

        // Add timestamp if enabled
        if (this.timestamps && !this.isTest) {
            const now = new Date();
            const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
            prefix.push(`[${timestamp}]`);
        }

        // Add log level if in verbose mode and (timestamps or colors are enabled)
        if (this.verbose && !this.isTest && (this.timestamps || this.colors)) {
            const levelStr = level.toUpperCase().padEnd(5);
            if (this.colors) {
                prefix.push(`${LOG_COLORS[level]}${levelStr}${LOG_COLORS.reset}`);
            } else {
                prefix.push(levelStr);
            }
        }

        // Combine prefix with original arguments
        if (prefix.length > 0) {
            return [prefix.join(' '), ...args];
        }
        return args;
    }

    /**
     * Log debug message (only in verbose mode)
     * @param {...any} args - Arguments to log
     */
    debug(...args) {
        if (this.isTest) return;
        if (this.verbose) {
            console.log(...this._formatMessage('debug', args));
        }
    }

    /**
     * Log info message (always shown)
     * @param {...any} args - Arguments to log
     */
    info(...args) {
        if (this.isTest) return;
        console.log(...this._formatMessage('info', args));
    }

    /**
     * Log warning message (always shown)
     * @param {...any} args - Arguments to log
     */
    warn(...args) {
        if (this.isTest) return;
        console.warn(...this._formatMessage('warn', args));
    }

    /**
     * Log error message (always shown)
     * @param {...any} args - Arguments to log
     */
    error(...args) {
        if (this.isTest) return;
        console.error(...this._formatMessage('error', args));
    }

    /**
     * Set topic status to in progress
     * @param {string} name - Topic name
     */
    topicProgress(name) {
        this.topics.set(name, 'progress');
        this._printTopicStatus(name, 'progress');
    }

    /**
     * Set topic status to complete
     * @param {string} name - Topic name
     */
    topicComplete(name) {
        this.topics.set(name, 'complete');
        this._printTopicStatus(name, 'complete');
    }

    /**
     * Set topic status to failed
     * @param {string} name - Topic name
     * @param {string} [reason] - Reason for failure
     */
    topicFailed(name, reason) {
        this.topics.set(name, 'failed');
        if (reason) {
            this.topicErrors.set(name, reason);
        }
        this._printTopicStatus(name, 'failed');
    }

    /**
     * Print topic status line
     * @param {string} name - Topic name
     * @param {string} status - Topic status
     * @private
     */
    _printTopicStatus(name, status) {
        if (this.isTest) return;
        if (this.verbose) return;

        const symbol = STATUS_SYMBOLS[status] || '[ ]';
        let output = `${symbol} ${name}`;

        // Add error reason for failed topics
        if (status === 'failed' && this.topicErrors.has(name)) {
            const reason = this.topicErrors.get(name);
            output += ` - ${reason}`;
        }

        if (status === 'progress') {
            // Start new line for progress, allow in-place updates
            process.stdout.write(`${output}`);
        } else if (status === 'complete' || status === 'failed') {
            // Overwrite progress line and add newline to move to next line
            process.stdout.write(`\r${output}\n`);
        } else {
            console.log(output);
        }
    }

    /**
     * Output section summary with statistics
     * @param {string} name - Section name
     * @param {string} statsString - Formatted statistics string
     */
    sectionSummary(name, statsString) {
        // Update internal state to mark as complete (even in test mode)
        this.topics.set(name, 'complete');

        if (this.isTest) return;

        const output = statsString ? `[V] ${name} — ${statsString}` : `[V] ${name}`;

        if (this.verbose) {
            console.log(output);
        } else {
            // Overwrite progress line with summary
            process.stdout.write(`\r${output}\n`);
        }
    }

    /**
     * Print final summary
     * @param {number} total - Total topics count
     * @param {number} failed - Failed topics count
     */
    printSummary(total, failed) {
        if (this.isTest) return;
        if (this.verbose) return;

        console.log('');
        if (failed === 0) {
            console.log(`Download complete: ${total} topics`);
        } else {
            console.log(`Download complete: ${total} topics, ${failed} failed`);
        }
    }

    /**
     * Log an action being performed (always shown)
     * Format: [timestamp] [ACTION] Message ID: Title
     * @param {string} action - Action type (EDIT, PUBLISH, DRY-RUN)
     * @param {number} messageId - Message ID
     * @param {string} title - Topic title or preview
     */
    action(action, messageId, title) {
        if (this.isTest) return;
        const timestamp = this._getTimestamp();
        console.log(`${timestamp} [${action}] Message ${messageId}: ${title}`);
    }

    /**
     * Log a completed action (always shown)
     * Format: [timestamp] [UPDATED|CREATED|UNCHANGED] Message ID: Title
     * @param {string} result - Result type (UPDATED, CREATED, UNCHANGED, RECREATED)
     * @param {number} messageId - Message ID
     * @param {string} title - Topic title
     */
    actionComplete(result, messageId, title) {
        if (this.isTest) return;
        const timestamp = this._getTimestamp();
        console.log(`${timestamp} [${result.toUpperCase()}] Message ${messageId}: ${title}`);
    }

    /**
     * Log sync summary (always shown)
     * Format: [timestamp] [SUMMARY] Created: X, Updated: Y, ...
     * @param {Object} stats - Statistics object
     */
    syncSummary(stats) {
        if (this.isTest) return;
        const timestamp = this._getTimestamp();
        const parts = [];
        if (stats.created > 0) parts.push(`Created: ${stats.created}`);
        if (stats.updated > 0) parts.push(`Updated: ${stats.updated}`);
        if (stats.recreated > 0) parts.push(`Recreated: ${stats.recreated}`);
        if (stats.unchanged > 0) parts.push(`Unchanged: ${stats.unchanged}`);
        if (stats.failed > 0) parts.push(`Failed: ${stats.failed}`);

        if (parts.length === 0) {
            parts.push('No changes');
        }

        console.log(`${timestamp} [SUMMARY] ${parts.join(', ')}`);
    }

    /**
     * Log download summary (always shown)
     * Format: [timestamp] [SUMMARY] Downloaded: X, Skipped: Y, ...
     * @param {Object} stats - Statistics object
     */
    downloadSummary(stats) {
        if (this.isTest) return;
        const timestamp = this._getTimestamp();
        const parts = [];
        if (stats.downloaded > 0) parts.push(`Downloaded: ${stats.downloaded}`);
        if (stats.skipped > 0) parts.push(`Skipped: ${stats.skipped}`);
        if (stats.dryRun > 0) parts.push(`Dry-run: ${stats.dryRun}`);
        if (stats.failed > 0) parts.push(`Failed: ${stats.failed}`);

        if (parts.length === 0) {
            parts.push('No changes');
        }

        console.log(`${timestamp} [SUMMARY] ${parts.join(', ')}`);
    }

    /**
     * Get formatted timestamp
     * @returns {string} Formatted timestamp
     * @private
     */
    _getTimestamp() {
        if (!this.timestamps) return '';
        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        return `[${timestamp}]`;
    }
}

/**
 * Create a custom logger for TelegramClient that filters out noisy messages
 * @param {boolean} verbose - Whether to show verbose output
 * @returns {Object} Logger object compatible with TelegramClient
 */
function createTelegramClientLogger(verbose) {
    // Create a formatter function for the Telegram client logger
    const formatMessage = (level, args) => {
        const prefix = [];

        // Add timestamp
        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        prefix.push(`[${timestamp}]`);

        // Add log level
        const levelStr = level.toUpperCase().padEnd(5);
        prefix.push(`${LOG_COLORS[level]}${levelStr}${LOG_COLORS.reset}`);

        return [prefix.join(' '), ...args];
    };

    if (!verbose) {
        return {
            info: () => {},
            warn: () => {},
            error: (...args) => console.error(...formatMessage('error', args)),  // Show errors even in non-verbose mode
            debug: () => {},
        };
    }

    return {
        info: (...args) => {
            const message = args[0];
            if (typeof message === 'string' &&
                (message.includes('Starting direct file download') ||
                 message.includes('chunks of') ||
                 message.includes('stride') ||
                 message.includes('Connecting to') ||
                 message.includes('Connection to') ||
                 message.includes('complete!') ||
                 message.includes('File lives in another DC') ||
                 message.includes('Exporting authorization') ||
                 message.includes('Disconnecting') ||
                 message.includes('connection closed'))) {
                return;
            }
            console.info(...formatMessage('info', args));
        },
        warn: (...args) => console.warn(...formatMessage('warn', args)),
        error: (...args) => console.error(...formatMessage('error', args)),
        debug: (...args) => console.debug(...formatMessage('debug', args)),
    };
}

module.exports = { TelegramLogger, createTelegramClientLogger, STATUS_SYMBOLS };

