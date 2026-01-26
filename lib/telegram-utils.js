/**
 * Telegram utility functions shared across modules
 * Extracted from download.js and pinned.js to avoid code duplication
 *
 * @module telegram/utils
 */

/**
 * Extract flood wait time from Telegram error message
 * @param {string} errorMessage - Error message containing FLOOD_WAIT_X
 * @returns {number} Wait time in seconds (default 30 if not found)
 */
function extractFloodWaitTime(errorMessage) {
    const match = errorMessage.match(/FLOOD_WAIT_(\d+)/);
    if (match) {
        return parseInt(match[1], 10);
    }
    // Default to 30 seconds if we can't parse the time
    return 30;
}

/**
 * Prompt for input from console
 * Used for authentication flow (verification code, 2FA password)
 * @returns {Promise<string>} User input trimmed
 */
function promptInput() {
    return new Promise((resolve) => {
        // Resume stdin if paused
        if (process.stdin.isPaused()) {
            process.stdin.resume();
        }
        process.stdin.setEncoding('utf8');

        // Clear any pending data
        process.stdin.removeAllListeners('data');

        process.stdin.once('data', (data) => {
            const input = data.toString().trim();
            process.stdin.pause();
            resolve(input);
        });
    });
}

/**
 * Create Telegram client start options with common callbacks
 * @param {Object} authConfig - Authentication configuration with phone
 * @param {Object} logger - Logger instance for output
 * @param {Object} deps - Optional dependencies for testing
 * @param {Function} deps.promptInput - Prompt function for authentication
 * @returns {Object} Start options for TelegramClient.start()
 */
function createClientStartOptions(authConfig, logger, deps = {}) {
    const prompt = deps.promptInput || promptInput;

    return {
        phoneNumber: async () => {
            if (logger && logger.debug) {
                logger.debug(`Using phone number: ${authConfig.phone}`);
            }
            return authConfig.phone;
        },
        password: async () => {
            if (logger && logger.info) {
                logger.info('\nTwo-factor authentication is enabled!');
                logger.info('Please enter your 2FA password:');
            }
            const password = await prompt();
            if (!password) {
                throw new Error('Password is required for 2FA');
            }
            return password;
        },
        phoneCode: async () => {
            if (logger && logger.info) {
                logger.info('\nEnter the code you received (via SMS or Telegram app):');
            }
            const code = await prompt();
            if (!code) {
                throw new Error('Verification code is required');
            }
            return code;
        },
        onError: (err) => {
            if (err.errorMessage === 'API_ID_INVALID') {
                if (logger && logger.error) {
                    logger.error('Invalid API credentials. Check api_id and api_hash in config/main.yml');
                    logger.error('Get API credentials from https://my.telegram.org/apps');
                }
                process.exit(1);
            }
            if (logger && logger.error) {
                logger.error('Telegram client error:', err);
            }
        },
    };
}

module.exports = {
    extractFloodWaitTime,
    promptInput,
    createClientStartOptions,
};
