const tap = require('tap');
const joi = require('../joi');

tap.test('bigint', t => {
    const test = (name, schema, input, ok = true) => t.test(name, assert => {
        assert.comment(`schema: ${JSON.stringify(schema.describe())}`);
        assert.comment(`input: ${JSON.stringify(input)}`);
        const { error = '' } = schema.validate(input);
        if (ok) assert.notOk(error, 'pass');
        else assert.ok(error, error.message || 'error expected');
        assert.end();
    });
    test('number', joi.bigint(), 1);
    test('random string', joi.bigint(), 'asd', false);
    test('stringified number', joi.bigint(), '11');
    test('stringified number overflow', joi.bigint(), '1'.repeat(20), false);
    test('zero', joi.bigint(), 0, false);
    test('negative number', joi.bigint(), -1, false);
    test('boolean', joi.bigint(), false, false);
    test('null', joi.bigint(), null, false);
    test('null explicitly allowed', joi.bigint().allow(null), null);
    test('object int value', joi.object({test: joi.bigint()}), {test: 1});
    test('object random string value', joi.object({test: joi.bigint()}), {test: 'asd'}, false);
    test('array int item', joi.array().items(joi.bigint()), [123]);
    t.end();
});
