const test = require('ava');
const { extractFloodWaitTime, createClientStartOptions } = require('../lib/telegram-utils');

test('extractFloodWaitTime() - should extract wait time from FLOOD_WAIT error', (t) => {
    t.is(extractFloodWaitTime('A flood error occurred: FLOOD_WAIT_10'), 10);
    t.is(extractFloodWaitTime('FLOOD_WAIT_30'), 30);
    t.is(extractFloodWaitTime('Error: FLOOD_WAIT_60 seconds'), 60);
});

test('extractFloodWaitTime() - should return default 30 when no time found', (t) => {
    t.is(extractFloodWaitTime('Some other error'), 30);
    t.is(extractFloodWaitTime('No flood wait here'), 30);
    t.is(extractFloodWaitTime(''), 30);
});


test('createClientStartOptions() - phoneNumber callback should return configured phone', async (t) => {
    const authConfig = { phone: '+1234567890' };
    const mockLogger = { debug: () => {}, info: () => {}, error: () => {} };
    const options = createClientStartOptions(authConfig, mockLogger);

    const phone = await options.phoneNumber();
    t.is(phone, '+1234567890');
});

test('createClientStartOptions() - onError should exit on API_ID_INVALID', (t) => {
    const authConfig = { phone: '+1234567890' };
    let errorLogged = false;
    let exitCalled = false;
    const mockLogger = {
        error: () => { errorLogged = true; },
    };

    // Mock process.exit
    const originalExit = process.exit;
    process.exit = () => { exitCalled = true; };

    const options = createClientStartOptions(authConfig, mockLogger);
    options.onError({ errorMessage: 'API_ID_INVALID' });

    t.true(errorLogged);
    t.true(exitCalled);

    process.exit = originalExit;
});


test('createClientStartOptions() - onError should log other errors', (t) => {
    const authConfig = { phone: '+1234567890' };
    let errorLogged = false;
    const mockLogger = {
        error: () => { errorLogged = true; },
    };

    const options = createClientStartOptions(authConfig, mockLogger);

    options.onError({ errorMessage: 'SOME_OTHER_ERROR' });

    t.true(errorLogged);
});


test('createClientStartOptions() - password callback should prompt for 2FA password', async (t) => {
    // Arrange
    const authConfig = { phone: '+1234567890' };
    let infoLogged = false;
    const mockLogger = {
        debug: () => {},
        info: () => { infoLogged = true; },
        error: () => {},
    };
    const mockPrompt = async () => 'test-password';

    // Act
    const options = createClientStartOptions(authConfig, mockLogger, { promptInput: mockPrompt });
    const password = await options.password();

    // Assert
    t.true(infoLogged);
    t.is(password, 'test-password');
});

test('createClientStartOptions() - password callback should throw error for empty password', async (t) => {
    // Arrange
    const authConfig = { phone: '+1234567890' };
    const mockLogger = {
        debug: () => {},
        info: () => {},
        error: () => {},
    };
    const mockPrompt = async () => '';

    // Act
    const options = createClientStartOptions(authConfig, mockLogger, { promptInput: mockPrompt });

    // Assert
    const error = await t.throwsAsync(async () => {
        await options.password();
    });
    t.is(error.message, 'Password is required for 2FA');
});

test('createClientStartOptions() - phoneCode callback should prompt for verification code', async (t) => {
    // Arrange
    const authConfig = { phone: '+1234567890' };
    let infoLogged = false;
    const mockLogger = {
        debug: () => {},
        info: () => { infoLogged = true; },
        error: () => {},
    };
    const mockPrompt = async () => '12345';

    // Act
    const options = createClientStartOptions(authConfig, mockLogger, { promptInput: mockPrompt });
    const code = await options.phoneCode();

    // Assert
    t.true(infoLogged);
    t.is(code, '12345');
});

test('createClientStartOptions() - phoneCode callback should throw error for empty code', async (t) => {
    // Arrange
    const authConfig = { phone: '+1234567890' };
    const mockLogger = {
        debug: () => {},
        info: () => {},
        error: () => {},
    };
    const mockPrompt = async () => '';

    // Act
    const options = createClientStartOptions(authConfig, mockLogger, { promptInput: mockPrompt });

    // Assert
    const error = await t.throwsAsync(async () => {
        await options.phoneCode();
    });
    t.is(error.message, 'Verification code is required');
});


