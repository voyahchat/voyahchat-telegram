const test = require('ava');
const { Api } = require('telegram/tl');
const { toGramJS, validate } = require('../lib/entity-converter');

// Tests for toGramJS
test('toGramJS() - should return empty array for empty input', (t) => {
    t.deepEqual(toGramJS([]), []);
    t.deepEqual(toGramJS(null), []);
    t.deepEqual(toGramJS(undefined), []);
});

test('toGramJS() - should convert bold entity to Api.MessageEntityBold', (t) => {
    const entities = [{ type: 'bold', offset: 0, length: 5 }];
    const result = toGramJS(entities);

    t.is(result.length, 1);
    t.true(result[0] instanceof Api.MessageEntityBold);
    t.is(result[0].offset, 0);
    t.is(result[0].length, 5);
});

test('toGramJS() - should convert text_link entity to Api.MessageEntityTextUrl', (t) => {
    const entities = [{ type: 'text_link', offset: 0, length: 5, url: 'https://example.com' }];
    const result = toGramJS(entities);

    t.is(result.length, 1);
    t.true(result[0] instanceof Api.MessageEntityTextUrl);
    t.is(result[0].offset, 0);
    t.is(result[0].length, 5);
    t.is(result[0].url, 'https://example.com');
});

test('toGramJS() - should convert multiple entities', (t) => {
    const entities = [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'text_link', offset: 10, length: 4, url: 'https://example.com' },
    ];
    const result = toGramJS(entities);

    t.is(result.length, 2);
    t.true(result[0] instanceof Api.MessageEntityBold);
    t.true(result[1] instanceof Api.MessageEntityTextUrl);
});

test('toGramJS() - should filter out unknown entity types', (t) => {
    const entities = [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'unknown', offset: 10, length: 4 },
    ];
    const result = toGramJS(entities);

    t.is(result.length, 1);
    t.true(result[0] instanceof Api.MessageEntityBold);
});

// Tests for validate
test('validate() - should not throw for valid entities', (t) => {
    const entities = [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'text_link', offset: 10, length: 4, url: 'https://example.com' },
    ];

    t.notThrows(() => validate(entities));
});

test('validate() - should not throw for empty input', (t) => {
    t.notThrows(() => validate([]));
    t.notThrows(() => validate(null));
    t.notThrows(() => validate(undefined));
});

test('validate() - should throw for invalid offset', (t) => {
    const entities = [{ type: 'bold', offset: -1, length: 5 }];

    t.throws(() => validate(entities), { message: /Invalid entity offset/ });
});

test('validate() - should throw for invalid length', (t) => {
    const entities = [{ type: 'bold', offset: 0, length: 0 }];

    t.throws(() => validate(entities), { message: /Invalid entity length/ });
});

test('validate() - should throw for unknown entity type', (t) => {
    const entities = [{ type: 'unknown', offset: 0, length: 5 }];

    t.throws(() => validate(entities), { message: /Unknown entity type/ });
});

test('validate() - should throw for text_link without url', (t) => {
    const entities = [{ type: 'text_link', offset: 0, length: 5 }];

    t.throws(() => validate(entities), { message: /text_link entity missing url/ });
});
