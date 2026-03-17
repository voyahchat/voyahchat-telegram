const test = require('ava');
const { TelegramLogger, createTelegramClientLogger } = require('../lib/logger');

// Store original console methods
const originalConsole = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    log: console.log,
};

// Restore console methods after each test
test.afterEach.always(() => {
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.log = originalConsole.log;
});

// TelegramLogger tests

test('TelegramLogger.sectionSummary() - should set topic status to complete', (t) => {
    // Create logger with isTest explicitly set to true to prevent console output
    const logger = new TelegramLogger();
    logger.isTest = true;

    logger.sectionSummary('test-section', '5 messages, 2Mb');

    t.is(logger.topics.get('test-section'), 'complete');
});

// createTelegramClientLogger tests

test('createTelegramClientLogger() - silent logger should not output info/warn/debug', (t) => {
    // Arrange
    const logger = createTelegramClientLogger(false);
    let infoOutput = '';
    let warnOutput = '';
    let debugOutput = '';

    // Mock console methods
    console.info = (...args) => { infoOutput = args.join(' '); };
    console.warn = (...args) => { warnOutput = args.join(' '); };
    console.debug = (...args) => { debugOutput = args.join(' '); };

    // Act
    logger.info('test info');
    logger.warn('test warn');
    logger.debug('test debug');

    // Assert
    // Silent logger should not produce output for info/warn/debug
    t.is(infoOutput, '');
    t.is(warnOutput, '');
    t.is(debugOutput, '');
});

test('createTelegramClientLogger() - silent logger should still output errors', (t) => {
    // Arrange
    const logger = createTelegramClientLogger(false);
    let errorOutput = '';
    console.error = (...args) => { errorOutput = args.join(' '); };

    // Act
    logger.error('test error');

    // Assert
    t.regex(errorOutput, /test error/);
});

test('createTelegramClientLogger() - verbose logger should output all levels', (t) => {
    // Arrange
    const logger = createTelegramClientLogger(true);
    let infoOutput = '';
    let warnOutput = '';
    let errorOutput = '';
    let debugOutput = '';

    // Mock console methods
    console.info = (...args) => { infoOutput = args.join(' '); };
    console.warn = (...args) => { warnOutput = args.join(' '); };
    console.error = (...args) => { errorOutput = args.join(' '); };
    console.debug = (...args) => { debugOutput = args.join(' '); };

    // Act
    logger.info('test info');
    logger.warn('test warn');
    logger.error('test error');
    logger.debug('test debug');

    // Assert
    // Verbose logger should produce output for all levels
    t.regex(infoOutput, /test info/);
    t.regex(warnOutput, /test warn/);
    t.regex(errorOutput, /test error/);
    t.regex(debugOutput, /test debug/);

    // Check that timestamps and colors are included
    t.regex(infoOutput, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    t.true(infoOutput.includes('\x1b[32m')); // Green color for info
    t.true(warnOutput.includes('\x1b[33m')); // Yellow color for warn
    t.true(errorOutput.includes('\x1b[31m')); // Red color for error
    t.true(debugOutput.includes('\x1b[36m')); // Cyan color for debug
});

test('TelegramLogger.sectionSummary() - should format output correctly', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: true }); // Use verbose to use console.log
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.sectionSummary('Test Section', '10 messages, 5MB');

    // Assert
    t.is(capturedOutput, '[V] Test Section — 10 messages, 5MB');
    t.is(logger.topics.get('Test Section'), 'complete');
});

test('TelegramLogger.sectionSummary() - should format output without stats', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: true }); // Use verbose to use console.log
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.sectionSummary('Test Section', '');

    // Assert
    t.is(capturedOutput, '[V] Test Section');
    t.is(logger.topics.get('Test Section'), 'complete');
});

test('TelegramLogger.sectionSummary() - should not output in test mode', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    // isTest is true by default when NODE_ENV is 'test'
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.sectionSummary('Test Section', '10 messages, 5MB');

    // Assert
    t.is(capturedOutput, '');
    t.is(logger.topics.get('Test Section'), 'complete');
});

test('createTelegramClientLogger() - should filter noisy messages in verbose mode', (t) => {
    // Arrange
    const logger = createTelegramClientLogger(true);
    let capturedOutput = '';
    console.info = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act - Call with a noisy message that should be filtered
    logger.info('Starting direct file download');

    // Assert - Output should be empty (filtered)
    t.is(capturedOutput, '');

    // Act - Call with a normal message
    logger.info('Normal message');

    // Assert - Output should contain the formatted message
    t.regex(capturedOutput, /\[/);
    t.regex(capturedOutput, /\]/);
    t.true(capturedOutput.includes('\x1b[32m')); // Green color for info
    t.true(capturedOutput.includes('INFO'));
    t.true(capturedOutput.includes('Normal message'));
});

test('TelegramLogger.info() - should handle object arguments in log methods', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: true });
    logger.isTest = false; // Override test mode for this test
    let capturedArgs = [];
    console.log = (...args) => {
        capturedArgs = args;
    };

    // Act
    const testObject = { key: 'value', number: 42 };
    logger.info('Test message with object:', testObject);

    // Assert
    t.is(capturedArgs.length, 3);
    t.regex(capturedArgs[0], /INFO/); // Check for log level prefix
    t.is(capturedArgs[1], 'Test message with object:');
    t.deepEqual(capturedArgs[2], testObject);
});

test('TelegramLogger.topicProgress() - should set topic status to progress', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = true; // Suppress output

    // Act
    logger.topicProgress('test-topic');

    // Assert
    t.is(logger.topics.get('test-topic'), 'progress');
});

test('TelegramLogger.topicComplete() - should set topic status to complete', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = true;

    // Act
    logger.topicComplete('test-topic');

    // Assert
    t.is(logger.topics.get('test-topic'), 'complete');
});

test('TelegramLogger.topicFailed() - should set topic status to failed with reason', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = true;

    // Act
    logger.topicFailed('test-topic', 'Connection error');

    // Assert
    t.is(logger.topics.get('test-topic'), 'failed');
    t.is(logger.topicErrors.get('test-topic'), 'Connection error');
});

test('TelegramLogger.topicFailed() - should set topic status to failed without reason', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = true;

    // Act
    logger.topicFailed('test-topic');

    // Assert
    t.is(logger.topics.get('test-topic'), 'failed');
    t.false(logger.topicErrors.has('test-topic'));
});

test('TelegramLogger.printSummary() - should output summary with failed count', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: false });
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.printSummary(10, 3);

    // Assert
    t.is(capturedOutput, 'Download complete: 10 topics, 3 failed');
    t.regex(capturedOutput, /10 topics/);
    t.regex(capturedOutput, /3 failed/);
});

test('TelegramLogger.printSummary() - should output summary without failed count', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: false });
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.printSummary(10, 0);

    // Assert
    t.is(capturedOutput, 'Download complete: 10 topics');
    t.regex(capturedOutput, /10 topics/);
    t.false(capturedOutput.includes('failed'));
});

test('TelegramLogger.printSummary() - should not output in test mode', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: false });
    // isTest is true by default when NODE_ENV is 'test'
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.printSummary(10, 3);

    // Assert
    t.is(capturedOutput, '');
});

test('TelegramLogger.printSummary() - should not output in verbose mode', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: true });
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.printSummary(10, 3);

    // Assert
    t.is(capturedOutput, '');
});

test('TelegramLogger.info() - should handle array arguments in log methods', (t) => {
    // Arrange
    const logger = new TelegramLogger({ verbose: true });
    logger.isTest = false; // Override test mode for this test
    let capturedArgs = [];
    console.log = (...args) => {
        capturedArgs = args;
    };

    // Act
    const testArray = ['item1', 'item2', 'item3'];
    logger.info('Test message with array:', testArray);

    // Assert
    t.is(capturedArgs.length, 3);
    t.regex(capturedArgs[0], /INFO/); // Check for log level prefix
    t.is(capturedArgs[1], 'Test message with array:');
    t.deepEqual(capturedArgs[2], testArray);
});

// downloadSummary tests

test('TelegramLogger.downloadSummary() - should output formatted summary with all stats', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.downloadSummary({
        downloaded: 5,
        skipped: 3,
        dryRun: 2,
        failed: 1,
    });

    // Assert
    t.regex(capturedOutput, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[SUMMARY\]/);
    t.true(capturedOutput.includes('Downloaded: 5'));
    t.true(capturedOutput.includes('Skipped: 3'));
    t.true(capturedOutput.includes('Dry-run: 2'));
    t.true(capturedOutput.includes('Failed: 1'));
});

test('TelegramLogger.downloadSummary() - should omit zero values from output', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.downloadSummary({
        downloaded: 5,
        skipped: 0,
        dryRun: 0,
        failed: 1,
    });

    // Assert
    t.regex(capturedOutput, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[SUMMARY\]/);
    t.true(capturedOutput.includes('Downloaded: 5'));
    t.false(capturedOutput.includes('Skipped: 0'));
    t.false(capturedOutput.includes('Dry-run: 0'));
    t.true(capturedOutput.includes('Failed: 1'));
});

test('TelegramLogger.downloadSummary() - should show No changes for empty stats', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.downloadSummary({
        downloaded: 0,
        skipped: 0,
        dryRun: 0,
        failed: 0,
    });

    // Assert
    t.regex(capturedOutput, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[SUMMARY\]/);
    t.true(capturedOutput.includes('No changes'));
    t.false(capturedOutput.includes('Downloaded:'));
    t.false(capturedOutput.includes('Skipped:'));
    t.false(capturedOutput.includes('Dry-run:'));
    t.false(capturedOutput.includes('Failed:'));
});

test('TelegramLogger.downloadSummary() - should not output in test mode', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    // isTest is true by default when NODE_ENV is 'test'
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.downloadSummary({
        downloaded: 5,
        skipped: 3,
        dryRun: 2,
        failed: 1,
    });

    // Assert
    t.is(capturedOutput, '');
});

test('TelegramLogger.downloadSummary() - should include dry-run in output when present', (t) => {
    // Arrange
    const logger = new TelegramLogger();
    logger.isTest = false; // Override test mode for this test
    let capturedOutput = '';
    console.log = (...args) => {
        capturedOutput = args.join(' ');
    };

    // Act
    logger.downloadSummary({
        downloaded: 0,
        skipped: 0,
        dryRun: 5,
        failed: 0,
    });

    // Assert
    t.regex(capturedOutput, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[SUMMARY\]/);
    t.true(capturedOutput.includes('Dry-run: 5'));
    t.false(capturedOutput.includes('Downloaded:'));
    t.false(capturedOutput.includes('Skipped:'));
    t.false(capturedOutput.includes('Failed:'));
});
