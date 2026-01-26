/**
 * Retry utility with exponential backoff and jitter
 * Provides robust retry logic for Telegram API operations
 *
 * @module telegram/retry
 */

const { TelegramLogger } = require('./logger');

// Create a logger instance for retry operations
const logger = new TelegramLogger({ verbose: true });

/**
 * Error types for categorization
 */
const ErrorTypes = {
    TIMEOUT: 'timeout',
    NETWORK: 'network',
    API: 'api',
    FATAL: 'fatal',
    RATE_LIMIT: 'rate_limit',
    AUTH: 'auth',
    VALIDATION: 'validation',
};

/**
 * Categorize error type based on error message and properties
 * @param {Error} error - The error to categorize
 * @returns {string} Error type from ErrorTypes
 */
function categorizeError(error) {
    if (!error || !error.message) {
        logger.error('Invalid error object provided to categorizeError');
        return ErrorTypes.FATAL;
    }

    const message = error.message.toLowerCase();
    const code = error.code;

    // Timeout errors
    if (message.includes('timeout') || message.includes('etimedout') || code === 'ETIMEDOUT') {
        return ErrorTypes.TIMEOUT;
    }

    // Rate limit errors
    if (message.includes('too many requests') ||
        message.includes('flood wait') ||
        message.includes('rate limit') ||
        code === 'FLOOD_WAIT') {
        return ErrorTypes.RATE_LIMIT;
    }

    // Authentication errors
    if (message.includes('unauthorized') ||
        message.includes('auth key') ||
        message.includes('authentication') ||
        code === 'UNAUTHORIZED' || code === 401) {
        return ErrorTypes.AUTH;
    }

    // Validation errors
    if (message.includes('invalid') ||
        message.includes('bad request') ||
        message.includes('validation') ||
        code === 'BAD_REQUEST' || code === 400) {
        return ErrorTypes.VALIDATION;
    }

    // Network errors
    if (message.includes('network') ||
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        return ErrorTypes.NETWORK;
    }

    // API errors that shouldn't be retried
    if (message.includes('message not found') ||
        message.includes('chat not found') ||
        message.includes('forbidden') ||
        message.includes('not found') ||
        code === 'FORBIDDEN' || code === 403 || code === 'NOT_FOUND' || code === 404) {
        return ErrorTypes.FATAL;
    }

    // Default to API error for retry
    return ErrorTypes.API;
}

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseDelayMs - Base delay in milliseconds
 * @param {number} maxDelayMs - Maximum delay in milliseconds
 * @param {number} jitterMs - Jitter range in milliseconds
 * @returns {number} Delay in milliseconds
 */
function calculateDelay(attempt, baseDelayMs, maxDelayMs, jitterMs) {
    // Exponential backoff: delay = baseDelay * 2^attempt
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * jitterMs;

    return Math.floor(cappedDelay + jitter);
}

/**
 * Calculate timeout based on file size
 * @param {number} fileSizeBytes - File size in bytes
 * @param {number} timeoutBaseMs - Base timeout in milliseconds
 * @param {number} timeoutPerMbMs - Additional timeout per MB
 * @param {number} timeoutMaxMs - Maximum timeout in milliseconds
 * @returns {number} Timeout in milliseconds
 */
function calculateTimeout(fileSizeBytes, timeoutBaseMs, timeoutPerMbMs, timeoutMaxMs) {
    if (!fileSizeBytes || fileSizeBytes <= 0) {
        return timeoutBaseMs;
    }

    // Convert bytes to MB
    const fileSizeMb = fileSizeBytes / (1024 * 1024);

    // Calculate timeout: base + (size * perMB)
    const calculatedTimeout = timeoutBaseMs + (fileSizeMb * timeoutPerMbMs);

    // Cap at maximum timeout
    return Math.min(calculatedTimeout, timeoutMaxMs);
}

/**
 * Execute an operation with retry logic
 * @param {Function} operation - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} [options.maxRetries=10] - Maximum number of retries
 * @param {number} [options.baseDelayMs=2000] - Base delay for exponential backoff
 * @param {number} [options.maxDelayMs=60000] - Maximum delay
 * @param {number} [options.jitterMs=1000] - Jitter range
 * @param {Function} [options.shouldRetry] - Custom function to determine if should retry
 * @param {Function} [options.onRetry] - Callback called on each retry
 * @param {string} [options.operationName='operation'] - Name of the operation for logging
 * @returns {Promise} Result of the operation
 * @throws {Error} The last error if all retries fail
 */
async function executeWithRetry(operation, options = {}) {
    // Validate inputs
    if (typeof operation !== 'function') {
        const error = new Error('Operation must be a function');
        logger.error('executeWithRetry: Invalid operation parameter', error);
        throw error;
    }

    const {
        maxRetries = 10,
        baseDelayMs = 2000,
        maxDelayMs = 60000,
        jitterMs = 1000,
        shouldRetry = null,
        onRetry = null,
        operationName = 'operation',
    } = options;

    // Validate options
    if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
        const error = new Error('maxRetries must be a non-negative integer');
        logger.error(`executeWithRetry: Invalid maxRetries value: ${maxRetries}`, error);
        throw error;
    }

    if (baseDelayMs < 0 || maxDelayMs < 0 || jitterMs < 0) {
        const error = new Error('Delay values must be non-negative');
        logger.error(
            `executeWithRetry: Invalid delay values: base=${baseDelayMs}, ` +
            `max=${maxDelayMs}, jitter=${jitterMs}`,
            error,
        );
        throw error;
    }

    let lastError = null;
    let actualAttempts = 0;
    const startTime = Date.now();

    logger.debug(`Starting ${operationName} with maxRetries=${maxRetries}`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Execute the operation
            const result = await operation();

            // If we get here, operation succeeded
            actualAttempts = attempt + 1;
            const duration = Date.now() - startTime;
            logger.debug(`${operationName} succeeded on attempt ${actualAttempts} after ${duration}ms`);
            return result;
        } catch (error) {
            lastError = error;
            actualAttempts = attempt + 1;

            // Ensure error has proper structure
            if (!error.message) {
                error.message = 'Unknown error occurred';
            }

            // Categorize error
            const errorType = categorizeError(error);

            // Log the error with context
            logger.warn(
                `${operationName} failed on attempt ${actualAttempts}/${maxRetries + 1}: ` +
                `${error.message} (${errorType})`,
            );

            // Check if we should retry
            if (attempt === maxRetries) {
                logger.error(`${operationName} failed after ${maxRetries + 1} attempts, no more retries`);
                break;
            }

            if (errorType === ErrorTypes.FATAL) {
                logger.error(`${operationName} encountered fatal error, not retrying: ${error.message}`);
                break;
            }

            // Use custom shouldRetry function if provided
            if (shouldRetry && !shouldRetry(error, attempt, errorType)) {
                logger.info(`${operationName}: Custom shouldRetry function returned false, not retrying`);
                break;
            }

            // Calculate delay for next attempt
            const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitterMs);
            logger.debug(`${operationName} will retry after ${delay}ms (attempt ${attempt + 2})`);

            // Call onRetry callback if provided
            if (onRetry) {
                try {
                    onRetry(error, attempt, delay, errorType);
                } catch (callbackError) {
                    logger.error(
                        `${operationName}: Error in onRetry callback`,
                        callbackError,
                    );
                }
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // All retries failed, throw the last error with enhanced context
    const duration = Date.now() - startTime;
    const enhancedError = new Error(
        `${operationName} failed after ${actualAttempts} attempts in ${duration}ms. Last error: ${lastError.message}`,
    );

    // Preserve original error properties
    Object.assign(enhancedError, lastError);
    enhancedError.originalError = lastError;
    enhancedError.attempts = actualAttempts;
    enhancedError.duration = duration;
    enhancedError.operationName = operationName;

    logger.error(`${operationName} failed completely after ${duration}ms`, enhancedError);
    throw enhancedError;
}

/**
 * Create a timeout promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [message='Operation timeout'] - Timeout error message
 * @returns {Promise} Promise that rejects after timeout
 */
function createTimeout(timeoutMs, message = 'Operation timeout') {
    // Validate inputs
    if (!timeoutMs || timeoutMs <= 0 || !Number.isInteger(timeoutMs)) {
        const error = new Error(`Invalid timeout value: ${timeoutMs}. Must be a positive integer.`);
        logger.error('createTimeout: Invalid timeoutMs parameter', error);
        return Promise.reject(error);
    }

    if (!message || typeof message !== 'string') {
        const error = new Error('Timeout message must be a non-empty string');
        logger.error('createTimeout: Invalid message parameter', error);
        return Promise.reject(error);
    }

    return new Promise((_, reject) => {
        setTimeout(() => {
            const timeoutError = new Error(message);
            timeoutError.isTimeout = true;
            timeoutError.timeoutMs = timeoutMs;
            reject(timeoutError);
        }, timeoutMs);
    });
}

/**
 * Execute an operation with timeout and retry
 * @param {Function} operation - Async function to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {Object} retryOptions - Retry options (same as executeWithRetry)
 * @returns {Promise} Result of the operation
 */
async function executeWithTimeoutAndRetry(operation, timeoutMs, retryOptions = {}) {
    // Validate inputs
    if (typeof operation !== 'function') {
        const error = new Error('Operation must be a function');
        logger.error('executeWithTimeoutAndRetry: Invalid operation parameter', error);
        throw error;
    }

    if (!timeoutMs || timeoutMs <= 0 || !Number.isInteger(timeoutMs)) {
        const error = new Error('timeoutMs must be a positive integer');
        logger.error(`executeWithTimeoutAndRetry: Invalid timeoutMs value: ${timeoutMs}`, error);
        throw error;
    }

    const operationName = retryOptions.operationName || 'operation';
    logger.debug(`Starting ${operationName} with timeout ${timeoutMs}ms`);

    return executeWithRetry(
        async () => {
            try {
                return await Promise.race([
                    operation(),
                    createTimeout(timeoutMs, `${operationName} timeout after ${timeoutMs}ms`),
                ]);
            } catch (error) {
                // Add timeout context to the error
                if (error.message.includes('timeout')) {
                    error.isTimeout = true;
                    error.timeoutMs = timeoutMs;
                }
                throw error;
            }
        },
        {
            ...retryOptions,
            operationName: `${operationName} (with timeout)`,
        },
    );
}

module.exports = {
    ErrorTypes,
    categorizeError,
    calculateDelay,
    calculateTimeout,
    executeWithRetry,
    executeWithTimeoutAndRetry,
    createTimeout,
};
