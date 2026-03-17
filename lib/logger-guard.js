/**
 * Logger guard for suppressing gramJS and other library messages
 * Provides centralized console suppression with optional filtering
 *
 * @module telegram/logger-guard
 */

/**
 * Logger guard class for console output suppression
 */
class LoggerGuard {
    /**
     * Create a new LoggerGuard
     * @param {Object} options - Guard options
     * @param {boolean} options.enabled - Whether suppression is enabled (default: true)
     * @param {Function} options.filter - Optional filter function for console.log
     */
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.filter = options.filter || null;
        this.originalConsole = null;
        this.suppressed = false;
    }

    /**
     * Start suppressing console output
     * @returns {LoggerGuard} this for chaining
     */
    suppress() {
        if (!this.enabled || this.suppressed) return this;

        this.originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        if (this.filter) {
            console.log = (...args) => {
                if (this.filter(args)) {
                    this.originalConsole.log(...args);
                }
            };
        } else {
            console.log = () => {};
        }

        console.info = () => {};
        console.warn = () => {};
        console.error = () => {};

        this.suppressed = true;
        return this;
    }

    /**
     * Restore console output
     * @returns {LoggerGuard} this for chaining
     */
    restore() {
        if (!this.suppressed || !this.originalConsole) return this;

        console.log = this.originalConsole.log;
        console.info = this.originalConsole.info;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;

        this.originalConsole = null;
        this.suppressed = false;
        return this;
    }

    /**
     * Execute async function with console suppressed
     * Automatically restores console after execution
     * @param {Function} fn - Async function to execute
     * @param {number} delayMs - Optional delay before/after for gramJS messages
     * @returns {Promise<any>} Result of the function
     */
    async run(fn, delayMs = 0) {
        this.suppress();

        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        try {
            return await fn();
        } finally {
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            this.restore();
        }
    }

    /**
     * Temporarily restore console, execute function, then suppress again
     * Useful for logging errors during suppression
     * @param {Function} fn - Function to execute with console restored
     */
    withConsole(fn) {
        if (!this.suppressed) {
            fn();
            return;
        }

        this.restore();
        fn();
        this.suppress();
    }
}

/**
 * Filter function for pinned.js that allows action logs through
 * @param {Array} args - Console.log arguments
 * @returns {boolean} True if message should be shown
 */
function pinnedActionFilter(args) {
    if (args.length === 0 || typeof args[0] !== 'string') return false;

    const allowedPatterns = [
        '[EDIT]', '[PUBLISH]', '[DRY-RUN]',
        '[UPDATED]', '[CREATED]', '[UNCHANGED]',
        '[RECREATED]', '[SUMMARY]',
    ];

    return allowedPatterns.some(pattern => args[0].includes(pattern));
}

module.exports = { LoggerGuard, pinnedActionFilter };
