const test = require('ava');
const sinon = require('sinon');
const { BotApi } = require('../lib/bot-api');

// Helper: create a mock fetch response
function mockFetchResponse(data, ok = true) {
    return sinon.stub(globalThis, 'fetch').resolves({
        json: async () => data,
        ok,
    });
}

test.afterEach(() => {
    sinon.restore();
});

// --- Constructor tests ---

test('BotApi constructor - should throw if no token provided', (t) => {
    t.throws(() => new BotApi(), { message: /Bot token is required/ });
    t.throws(() => new BotApi(''), { message: /Bot token is required/ });
    t.throws(() => new BotApi(null), { message: /Bot token is required/ });
});

test('BotApi constructor - should create instance with valid token', (t) => {
    const api = new BotApi('test-token-123');
    t.truthy(api);
    t.is(api.baseUrl, 'https://api.telegram.org/bottest-token-123');
});

test('BotApi constructor - should accept custom timeout', (t) => {
    const api = new BotApi('test-token', { requestTimeout: 5000 });
    t.is(api.requestTimeout, 5000);
});

// --- request() tests ---

test.serial('BotApi.request() - should make POST request with JSON body', async (t) => {
    const fetchStub = mockFetchResponse({ ok: true, result: { id: 123 } });
    const api = new BotApi('test-token');

    const result = await api.request('getMe');

    t.is(result.id, 123);
    t.is(fetchStub.callCount, 1);

    const [url, options] = fetchStub.firstCall.args;
    t.is(url, 'https://api.telegram.org/bottest-token/getMe');
    t.is(options.method, 'POST');
    t.is(options.headers['Content-Type'], 'application/json');
});

test.serial('BotApi.request() - should pass parameters in body', async (t) => {
    const fetchStub = mockFetchResponse({ ok: true, result: {} });
    const api = new BotApi('test-token');

    await api.request('sendMessage', { chat_id: 123, text: 'hello' });

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.chat_id, 123);
    t.is(body.text, 'hello');
});

test.serial('BotApi.request() - should throw on API error', async (t) => {
    mockFetchResponse({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message text is empty',
    });
    const api = new BotApi('test-token');

    const err = await t.throwsAsync(() => api.request('sendMessage'));
    t.true(err.message.includes('Bad Request'));
    t.is(err.errorCode, 400);
    t.is(err.description, 'Bad Request: message text is empty');
});

test.serial('BotApi.request() - should throw on network error', async (t) => {
    sinon.stub(globalThis, 'fetch').rejects(new Error('Network error'));
    const api = new BotApi('test-token');

    await t.throwsAsync(() => api.request('getMe'), { message: /Network error/ });
});

// --- getMe() tests ---

test.serial('BotApi.getMe() - should return bot info', async (t) => {
    mockFetchResponse({
        ok: true,
        result: { id: 123, is_bot: true, first_name: 'TestBot' },
    });
    const api = new BotApi('test-token');

    const result = await api.getMe();

    t.is(result.id, 123);
    t.true(result.is_bot);
});

// --- sendMessage() tests ---

test.serial('BotApi.sendMessage() - should send text message', async (t) => {
    const fetchStub = mockFetchResponse({
        ok: true,
        result: { message_id: 456, text: 'hello' },
    });
    const api = new BotApi('test-token');

    const result = await api.sendMessage({
        chatId: -100123,
        text: 'hello',
    });

    t.is(result.message_id, 456);

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.chat_id, -100123);
    t.is(body.text, 'hello');
    t.true(body.disable_web_page_preview);
});

test.serial('BotApi.sendMessage() - should include entities and thread ID', async (t) => {
    const fetchStub = mockFetchResponse({
        ok: true,
        result: { message_id: 789 },
    });
    const api = new BotApi('test-token');

    const entities = [{ type: 'bold', offset: 0, length: 5 }];
    await api.sendMessage({
        chatId: -100123,
        text: 'hello world',
        entities,
        messageThreadId: 8977,
    });

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.deepEqual(body.entities, entities);
    t.is(body.message_thread_id, 8977);
});

test.serial('BotApi.sendMessage() - should not include empty entities', async (t) => {
    const fetchStub = mockFetchResponse({
        ok: true,
        result: { message_id: 789 },
    });
    const api = new BotApi('test-token');

    await api.sendMessage({
        chatId: -100123,
        text: 'plain text',
        entities: [],
    });

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.entities, undefined);
});

// --- editMessageText() tests ---

test.serial('BotApi.editMessageText() - should edit message text', async (t) => {
    const fetchStub = mockFetchResponse({
        ok: true,
        result: { message_id: 456, text: 'updated' },
    });
    const api = new BotApi('test-token');

    const result = await api.editMessageText({
        chatId: -100123,
        messageId: 456,
        text: 'updated',
    });

    t.is(result.message_id, 456);

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.chat_id, -100123);
    t.is(body.message_id, 456);
    t.is(body.text, 'updated');
});

test.serial('BotApi.editMessageText() - should include entities', async (t) => {
    const fetchStub = mockFetchResponse({
        ok: true,
        result: { message_id: 456 },
    });
    const api = new BotApi('test-token');

    const entities = [{ type: 'text_link', offset: 0, length: 4, url: 'https://example.com' }];
    await api.editMessageText({
        chatId: -100123,
        messageId: 456,
        text: 'link text',
        entities,
    });

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.deepEqual(body.entities, entities);
});

// --- pinChatMessage() tests ---

test.serial('BotApi.pinChatMessage() - should pin message', async (t) => {
    const fetchStub = mockFetchResponse({ ok: true, result: true });
    const api = new BotApi('test-token');

    const result = await api.pinChatMessage({
        chatId: -100123,
        messageId: 456,
    });

    t.true(result);

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.chat_id, -100123);
    t.is(body.message_id, 456);
    t.true(body.disable_notification);
});

// --- deleteMessage() tests ---

test.serial('BotApi.deleteMessage() - should call API correctly', async (t) => {
    const fetchStub = mockFetchResponse({ ok: true, result: true });
    const api = new BotApi('test-token');

    const result = await api.deleteMessage({
        chatId: -100123,
        messageId: 456,
    });

    t.true(result);

    const body = JSON.parse(fetchStub.firstCall.args[1].body);
    t.is(body.chat_id, -100123);
    t.is(body.message_id, 456);
});

// --- Static error helpers ---

test('BotApi.isMessageNotModified() - should detect not modified error', (t) => {
    const err = new Error('test');
    err.description = 'Bad Request: message is not modified';
    t.true(BotApi.isMessageNotModified(err));

    t.false(BotApi.isMessageNotModified(new Error('other')));
    t.false(BotApi.isMessageNotModified(null));
});

test('BotApi.isMessageNotFound() - should detect not found error', (t) => {
    const err1 = new Error('test');
    err1.description = 'Bad Request: message to edit not found';
    t.true(BotApi.isMessageNotFound(err1));

    const err2 = new Error('test');
    err2.description = 'Bad Request: MESSAGE_ID_INVALID';
    t.true(BotApi.isMessageNotFound(err2));

    t.false(BotApi.isMessageNotFound(new Error('other')));
    t.false(BotApi.isMessageNotFound(null));
});
