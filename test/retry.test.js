const test = require('ava');
const {
    ErrorTypes,
    categorizeError,
    calculateDelay,
    calculateTimeout,
    executeWithRetry,
    executeWithTimeoutAndRetry,
    createTimeout,
} = require('../lib/retry');

test('categorizeError() - should categorize timeout errors', (t) => {
    // Arrange
    const error = new Error('Request timeout');
    const etimedoutError = new Error('ETIMEDOUT');

    // Act
    const result1 = categorizeError(error);
    const result2 = categorizeError(etimedoutError);

    // Assert
    t.is(result1, ErrorTypes.TIMEOUT);
    t.is(result2, ErrorTypes.TIMEOUT);
});

test('categorizeError() - should categorize fatal errors', (t) => {
    // Arrange
    const messageNotFoundError = new Error('message not found');
    const chatNotFoundError = new Error('chat not found');
    const forbiddenError = new Error('forbidden');

    // Act
    const result1 = categorizeError(messageNotFoundError);
    const result2 = categorizeError(chatNotFoundError);
    const result3 = categorizeError(forbiddenError);

    // Assert
    t.is(result1, ErrorTypes.FATAL);
    t.is(result2, ErrorTypes.FATAL);
    t.is(result3, ErrorTypes.FATAL);
});

test('calculateDelay() - should calculate exponential backoff with jitter', (t) => {
    // Arrange
    const baseDelay = 1000;
    const maxDelay = 10000;
    const jitter = 100;

    // Act
    const delay0 = calculateDelay(0, baseDelay, maxDelay, jitter);
    const delay1 = calculateDelay(1, baseDelay, maxDelay, jitter);
    const delay2 = calculateDelay(2, baseDelay, maxDelay, jitter);
    const delayHigh = calculateDelay(20, baseDelay, maxDelay, jitter);

    // Assert
    // First attempt (0)
    t.true(delay0 >= baseDelay && delay0 < baseDelay + jitter);
    // Second attempt (1)
    t.true(delay1 >= baseDelay * 2 && delay1 < baseDelay * 2 + jitter);
    // Third attempt (2)
    t.true(delay2 >= baseDelay * 4 && delay2 < baseDelay * 4 + jitter);
    // Should cap at maxDelay
    t.true(delayHigh >= maxDelay && delayHigh < maxDelay + jitter);
});

test('calculateTimeout() - should calculate timeout based on file size', (t) => {
    // Arrange
    const baseTimeout = 60000;
    const timeoutPerMb = 30000;
    const maxTimeout = 600000;

    // Act
    const result0 = calculateTimeout(0, baseTimeout, timeoutPerMb, maxTimeout);
    const result1Mb = calculateTimeout(1024 * 1024, baseTimeout, timeoutPerMb, maxTimeout);
    const result5Mb = calculateTimeout(5 * 1024 * 1024, baseTimeout, timeoutPerMb, maxTimeout);
    const resultLarge = calculateTimeout(100 * 1024 * 1024, baseTimeout, timeoutPerMb, maxTimeout);

    // Assert
    // No file size
    t.is(result0, baseTimeout);
    // 1 MB file
    t.is(result1Mb, baseTimeout + timeoutPerMb);
    // 5 MB file
    t.is(result5Mb, baseTimeout + (5 * timeoutPerMb));
    // Should cap at maxTimeout
    t.is(resultLarge, maxTimeout);
});

test('executeWithRetry() - should succeed on first attempt', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        return 'success';
    };

    // Act
    const result = await executeWithRetry(operation, { maxRetries: 3 });

    // Assert
    t.is(result, 'success');
    t.is(attempts, 1);
});

test('executeWithRetry() - should retry on failure', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        if (attempts < 3) {
            throw new Error('Temporary failure');
        }
        return 'success';
    };

    // Act
    const result = await executeWithRetry(operation, {
        maxRetries: 5,
        baseDelayMs: 10,
        jitterMs: 0,
    });

    // Assert
    t.is(result, 'success');
    t.is(attempts, 3);
});

test('executeWithRetry() - should fail after max retries', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        throw new Error('Persistent failure');
    };

    // Act
    const error = await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 2,
            baseDelayMs: 10,
            jitterMs: 0,
        }),
    );

    // Assert
    t.true(error.message.includes('Persistent failure'));
    t.true(error.message.includes('failed after 3 attempts'));
    t.is(error.attempts, 3);
    t.is(attempts, 3); // Initial attempt + 2 retries
});

test('executeWithRetry() - should not retry fatal errors', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        throw new Error('message not found');
    };

    // Act
    const error = await t.throwsAsync(
        executeWithRetry(operation, { maxRetries: 5 }),
    );

    // Assert
    t.true(error.message.includes('message not found'));
    t.is(error.attempts, 1);
    t.is(attempts, 1); // Should not retry
});

test('executeWithRetry() - should call onRetry callback', async (t) => {
    // Arrange
    let attempts = 0;
    let retryCount = 0;
    const operation = async () => {
        attempts++;
        if (attempts < 3) {
            throw new Error('Temporary failure');
        }
        return 'success';
    };

    const onRetry = (error, attempt, delay, errorType) => {
        retryCount++;
        t.is(error.message, 'Temporary failure');
        t.is(attempt, attempts - 1);
        t.true(delay > 0);
        t.is(errorType, ErrorTypes.API);
    };

    // Act
    await executeWithRetry(operation, {
        maxRetries: 5,
        baseDelayMs: 10,
        jitterMs: 0,
        onRetry,
    });

    // Assert
    t.is(retryCount, 2);
});

test('executeWithTimeoutAndRetry() - should timeout operation', async (t) => {
    // Arrange
    const operation = async () => {
        return new Promise((resolve) => {
            setTimeout(() => resolve('success'), 1000);
        });
    };

    // Act
    const error = await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, 100, { maxRetries: 0 }),
    );

    // Assert
    t.true(error.message.includes('timeout after 100ms'));
    t.true(error.message.includes('failed after 1 attempts'));
    t.true(error.isTimeout);
    t.is(error.timeoutMs, 100);
});

test('createTimeout() - should reject after timeout', async (t) => {
    // Arrange & Act & Assert
    await t.throwsAsync(
        createTimeout(50, 'Custom timeout message'),
        { message: 'Custom timeout message' },
    );
});

test('executeWithRetry() - should preserve error structure and add context', async (t) => {
    // Arrange
    const originalError = new Error('Original error message');
    originalError.code = 'CUSTOM_CODE';
    originalError.customProperty = 'custom value';

    const operation = async () => {
        throw originalError;
    };

    // Act
    const error = await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 2,
            baseDelayMs: 10,
            jitterMs: 0,
            operationName: 'test operation',
        }),
    );

    // Assert
    t.true(error.message.includes('test operation failed after 3 attempts'));
    t.true(error.message.includes('Original error message'));
    t.is(error.code, 'CUSTOM_CODE');
    t.is(error.customProperty, 'custom value');
    t.is(error.originalError, originalError);
    t.is(error.attempts, 3);
    t.true(error.duration > 0);
    t.is(error.operationName, 'test operation');
});

test('executeWithRetry() - should handle errors without message', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        const error = new Error();
        delete error.message;
        throw error;
    };

    // Act
    const error = await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 1,
            baseDelayMs: 10,
            jitterMs: 0,
        }),
    );

    // Assert
    t.true(error.message.includes('Unknown error occurred'));
    t.is(attempts, 2);
});

test('executeWithRetry() - should use custom shouldRetry function', async (t) => {
    // Arrange
    let attempts = 0;
    const operation = async () => {
        attempts++;
        throw new Error('Custom error');
    };

    const shouldRetry = (error, attempt, errorType) => {
        t.is(error.message, 'Custom error');
        t.is(errorType, ErrorTypes.API);
        return attempt < 1; // Only retry once
    };

    // Act
    const error = await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 5,
            baseDelayMs: 10,
            jitterMs: 0,
            shouldRetry,
        }),
    );

    // Assert
    t.true(error.message.includes('Custom error'));
    t.is(attempts, 2); // Initial attempt + 1 retry
});

test('executeWithTimeoutAndRetry() - should add timeout context to errors', async (t) => {
    // Arrange
    const operation = async () => {
        throw new Error('Operation failed');
    };

    // Act
    const error = await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, 1000, {
            maxRetries: 0,
            operationName: 'timeout test',
        }),
    );

    // Assert
    t.true(error.message.includes('Operation failed'));
    // The error should not have isTimeout property since it's not a timeout error
    t.is(error.isTimeout, undefined);
});

test('executeWithTimeoutAndRetry() - should handle timeout errors with context', async (t) => {
    // Arrange
    const operation = async () => {
        return new Promise((resolve) => {
            setTimeout(() => resolve('success'), 200);
        });
    };

    // Act
    const error = await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, 100, {
            maxRetries: 0,
            operationName: 'timeout test',
        }),
    );

    // Assert
    t.true(error.message.includes('timeout test timeout after 100ms'));
    t.true(error.isTimeout);
    t.is(error.timeoutMs, 100);
});

test('createTimeout() - should validate timeout parameter', async (t) => {
    // Arrange & Act & Assert
    await t.throwsAsync(
        createTimeout(0, 'Valid message'),
        { message: 'Invalid timeout value: 0. Must be a positive integer.' },
    );

    await t.throwsAsync(
        createTimeout(-100, 'Valid message'),
        { message: 'Invalid timeout value: -100. Must be a positive integer.' },
    );

    await t.throwsAsync(
        createTimeout(100.5, 'Valid message'),
        { message: 'Invalid timeout value: 100.5. Must be a positive integer.' },
    );
});

test('createTimeout() - should validate message parameter', async (t) => {
    // Arrange & Act & Assert
    await t.throwsAsync(
        createTimeout(100, ''),
        { message: 'Timeout message must be a non-empty string' },
    );

    await t.throwsAsync(
        createTimeout(100, null),
        { message: 'Timeout message must be a non-empty string' },
    );

    await t.throwsAsync(
        createTimeout(100, 123),
        { message: 'Timeout message must be a non-empty string' },
    );
});

test('executeWithRetry() - should validate operation parameter', async (t) => {
    // Arrange & Act & Assert
    await t.throwsAsync(
        executeWithRetry(null, { maxRetries: 1 }),
        { message: 'Operation must be a function' },
    );

    await t.throwsAsync(
        executeWithRetry('not a function', { maxRetries: 1 }),
        { message: 'Operation must be a function' },
    );
});

test('executeWithRetry() - should validate maxRetries parameter', async (t) => {
    // Arrange
    const operation = async () => 'success';

    // Act & Assert
    await t.throwsAsync(
        executeWithRetry(operation, { maxRetries: -1 }),
        { message: 'maxRetries must be a non-negative integer' },
    );

    await t.throwsAsync(
        executeWithRetry(operation, { maxRetries: 1.5 }),
        { message: 'maxRetries must be a non-negative integer' },
    );
});

test('executeWithRetry() - should validate delay parameters', async (t) => {
    // Arrange
    const operation = async () => 'success';

    // Act & Assert
    await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 1,
            baseDelayMs: -100,
        }),
        { message: 'Delay values must be non-negative' },
    );

    await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 1,
            maxDelayMs: -100,
        }),
        { message: 'Delay values must be non-negative' },
    );

    await t.throwsAsync(
        executeWithRetry(operation, {
            maxRetries: 1,
            jitterMs: -100,
        }),
        { message: 'Delay values must be non-negative' },
    );
});

test('executeWithTimeoutAndRetry() - should validate timeoutMs parameter', async (t) => {
    // Arrange
    const operation = async () => 'success';

    // Act & Assert
    await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, 0),
        { message: 'timeoutMs must be a positive integer' },
    );

    await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, -100),
        { message: 'timeoutMs must be a positive integer' },
    );

    await t.throwsAsync(
        executeWithTimeoutAndRetry(operation, 100.5),
        { message: 'timeoutMs must be a positive integer' },
    );
});

test('executeWithTimeoutAndRetry() - should validate operation parameter', async (t) => {
    // Arrange & Act & Assert
    await t.throwsAsync(
        executeWithTimeoutAndRetry(null, 100),
        { message: 'Operation must be a function' },
    );

    await t.throwsAsync(
        executeWithTimeoutAndRetry('not a function', 100),
        { message: 'Operation must be a function' },
    );
});
