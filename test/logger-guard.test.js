const test = require('ava');
const { LoggerGuard, pinnedActionFilter } = require('../lib/logger-guard');

// Store original console methods
const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
};

// Restore console methods after each test
test.afterEach.always(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
});

// Constructor tests

test('LoggerGuard.constructor() - should initialize with default options', (t) => {
    // Arrange & Act
    const guard = new LoggerGuard();

    // Assert
    t.true(guard.enabled);
    t.is(guard.filter, null);
    t.is(guard.originalConsole, null);
    t.false(guard.suppressed);
});

test('LoggerGuard.constructor() - should initialize with custom options', (t) => {
    // Arrange
    const options = {
        enabled: false,
        filter: () => true,
    };

    // Act
    const guard = new LoggerGuard(options);

    // Assert
    t.false(guard.enabled);
    t.is(typeof guard.filter, 'function');
    t.is(guard.originalConsole, null);
    t.false(guard.suppressed);
});

test('LoggerGuard.constructor() - should initialize with enabled explicitly set to true', (t) => {
    // Arrange
    const options = {
        enabled: true,
    };

    // Act
    const guard = new LoggerGuard(options);

    // Assert
    t.true(guard.enabled);
});

// suppress() tests

test('LoggerGuard.suppress() - should suppress console when enabled', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    let logCalled = false;
    let infoCalled = false;
    let warnCalled = false;
    let errorCalled = false;

    console.log = () => { logCalled = true; };
    console.info = () => { infoCalled = true; };
    console.warn = () => { warnCalled = true; };
    console.error = () => { errorCalled = true; };

    // Act
    guard.suppress();
    console.log('test');
    console.info('test');
    console.warn('test');
    console.error('test');

    // Assert
    t.true(guard.suppressed);
    t.true(guard.originalConsole !== null);
    t.false(logCalled);
    t.false(infoCalled);
    t.false(warnCalled);
    t.false(errorCalled);
});

test('LoggerGuard.suppress() - should not suppress when disabled', (t) => {
    // Arrange
    const guard = new LoggerGuard({ enabled: false });
    let logCalled = false;

    console.log = () => { logCalled = true; };

    // Act
    guard.suppress();
    console.log('test');

    // Assert
    t.false(guard.suppressed);
    t.is(guard.originalConsole, null);
    t.true(logCalled);
});

test('LoggerGuard.suppress() - should not suppress when already suppressed', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    guard.suppress();
    const originalConsole = guard.originalConsole;

    // Act
    const result = guard.suppress();

    // Assert
    t.is(result, guard);
    t.is(guard.originalConsole, originalConsole);
});

test('LoggerGuard.suppress() - should use filter when provided', (t) => {
    // Arrange
    const filter = (args) => args[0] === 'allowed';
    const guard = new LoggerGuard({ filter });
    let logCalled = false;
    let capturedArgs = null;

    console.log = (...args) => {
        logCalled = true;
        capturedArgs = args;
    };

    // Act
    guard.suppress();
    console.log('allowed');
    console.log('blocked');

    // Assert
    t.true(guard.suppressed);
    t.true(logCalled);
    t.deepEqual(capturedArgs, ['allowed']);
});

test('LoggerGuard.suppress() - should return this for chaining', (t) => {
    // Arrange
    const guard = new LoggerGuard();

    // Act
    const result = guard.suppress();

    // Assert
    t.is(result, guard);
});

// restore() tests

test('LoggerGuard.restore() - should restore console when suppressed', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    guard.suppress();
    let logCalled = false;
    let infoCalled = false;
    let warnCalled = false;
    let errorCalled = false;

    // Store the original console methods from the guard
    const originalLog = guard.originalConsole.log;
    const originalInfo = guard.originalConsole.info;
    const originalWarn = guard.originalConsole.warn;
    const originalError = guard.originalConsole.error;

    // Override the original methods to track calls
    guard.originalConsole.log = () => { logCalled = true; };
    guard.originalConsole.info = () => { infoCalled = true; };
    guard.originalConsole.warn = () => { warnCalled = true; };
    guard.originalConsole.error = () => { errorCalled = true; };

    // Act
    guard.restore();
    console.log('test');
    console.info('test');
    console.warn('test');
    console.error('test');

    // Assert
    t.false(guard.suppressed);
    t.is(guard.originalConsole, null);
    t.true(logCalled);
    t.true(infoCalled);
    t.true(warnCalled);
    t.true(errorCalled);

    // Restore the original methods for cleanup
    guard.originalConsole = {
        log: originalLog,
        info: originalInfo,
        warn: originalWarn,
        error: originalError,
    };
});

test('LoggerGuard.restore() - should not restore when not suppressed', (t) => {
    // Arrange
    const guard = new LoggerGuard();

    // Act
    const result = guard.restore();

    // Assert
    t.is(result, guard);
    t.false(guard.suppressed);
    t.is(guard.originalConsole, null);
});

test('LoggerGuard.restore() - should return this for chaining', (t) => {
    // Arrange
    const guard = new LoggerGuard();

    // Act
    const result = guard.restore();

    // Assert
    t.is(result, guard);
});

// run() tests

test('LoggerGuard.run() - should execute function with suppressed console', async (t) => {
    // Arrange
    const guard = new LoggerGuard();
    let logCalled = false;
    let functionExecuted = false;

    console.log = () => { logCalled = true; };
    const testFunction = async () => {
        functionExecuted = true;
        console.log('test');
        return 'result';
    };

    // Act
    const result = await guard.run(testFunction);

    // Assert
    t.is(result, 'result');
    t.true(functionExecuted);
    t.false(logCalled);
    t.false(guard.suppressed);
});

test('LoggerGuard.run() - should restore console even if function throws', async (t) => {
    // Arrange
    const guard = new LoggerGuard();
    const testFunction = async () => {
        throw new Error('Test error');
    };

    // Act & Assert
    await t.throwsAsync(guard.run(testFunction), { message: 'Test error' });
    t.false(guard.suppressed);
});

test('LoggerGuard.run() - should add delay before and after when specified', async (t) => {
    // Arrange
    const guard = new LoggerGuard();
    const testFunction = async () => {
        return 'result';
    };

    // Act
    const startTime = Date.now();
    const result = await guard.run(testFunction, 50);
    const endTime = Date.now();

    // Assert
    t.is(result, 'result');
    t.true(endTime - startTime >= 100); // At least 100ms total delay (50ms before + 50ms after)
});

test('LoggerGuard.run() - should not suppress when disabled', async (t) => {
    // Arrange
    const guard = new LoggerGuard({ enabled: false });
    let logCalled = false;
    let functionExecuted = false;

    console.log = () => { logCalled = true; };
    const testFunction = async () => {
        functionExecuted = true;
        console.log('test');
        return 'result';
    };

    // Act
    const result = await guard.run(testFunction);

    // Assert
    t.is(result, 'result');
    t.true(functionExecuted);
    t.true(logCalled);
});

// withConsole() tests

test('LoggerGuard.withConsole() - should temporarily restore console', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    guard.suppress();
    let logCalled = false;

    console.log = () => { logCalled = true; }; // This is the suppressed version

    // Act
    guard.withConsole(() => {
        console.log('test');
    });

    // Assert
    t.true(guard.suppressed); // Should still be suppressed after
    t.false(logCalled); // Suppressed console.log should not be called
});

test('LoggerGuard.withConsole() - should execute function with restored console', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    guard.suppress();
    let logCalled = false;
    let logArgs = null;

    // Override the restored console.log
    guard.originalConsole.log = (...args) => {
        logCalled = true;
        logArgs = args;
    };

    // Act
    guard.withConsole(() => {
        console.log('test');
    });

    // Assert
    t.true(guard.suppressed); // Should still be suppressed after
    t.true(logCalled);
    t.deepEqual(logArgs, ['test']);
});

test('LoggerGuard.withConsole() - should work when not suppressed', (t) => {
    // Arrange
    const guard = new LoggerGuard();
    let logCalled = false;

    console.log = () => { logCalled = true; };

    // Act
    guard.withConsole(() => {
        console.log('test');
    });

    // Assert
    t.false(guard.suppressed);
    t.true(logCalled);
});

// pinnedActionFilter tests

test('pinnedActionFilter() - should allow messages with allowed patterns', (t) => {
    // Arrange
    const allowedMessages = [
        '[EDIT] Updated message',
        '[PUBLISH] Published message',
        '[DRY-RUN] Dry run message',
        '[UPDATED] Updated file',
        '[CREATED] Created file',
        '[UNCHANGED] Unchanged file',
        '[RECREATED] Recreated file',
        '[SUMMARY] Summary message',
    ];

    // Act & Assert
    allowedMessages.forEach(message => {
        t.true(pinnedActionFilter([message]), `Should allow: ${message}`);
    });
});

test('pinnedActionFilter() - should block messages without allowed patterns', (t) => {
    // Arrange
    const blockedMessages = [
        'Random message',
        '[OTHER] Other message',
        'edit message',
        'publish message',
        '',
    ];

    // Act & Assert
    blockedMessages.forEach(message => {
        t.false(pinnedActionFilter([message]), `Should block: ${message}`);
    });
});

test('pinnedActionFilter() - should handle empty args', (t) => {
    // Arrange & Act & Assert
    t.false(pinnedActionFilter([]));
});

test('pinnedActionFilter() - should handle non-string first arg', (t) => {
    // Arrange & Act & Assert
    t.false(pinnedActionFilter([123]));
    t.false(pinnedActionFilter([{}]));
    t.false(pinnedActionFilter([[]]));
});

test('pinnedActionFilter() - should handle multiple args', (t) => {
    // Arrange & Act & Assert
    t.true(pinnedActionFilter(['[EDIT] Updated message', 'additional info']));
    t.false(pinnedActionFilter(['Random message', 'additional info']));
});
