const tap = require('tap');
const utRun = require('..');

tap.test('main function', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: ({utPort}) => class Test extends utPort {},
        config: {}
    });
    assert.ok(ports.length === 1, 'exactly one port');
    assert.ok(ports[0].constructor.name === 'Test', 'correct constructor Test');
    return stop();
});

tap.test('main object', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: {
            layer: [
                ({utPort}) => class Test extends utPort {},
                ({utPort}) => class Test2 extends utPort {}
            ]
        },
        config: {}
    });
    assert.ok(ports.length === 2, '2 ports');
    assert.ok(ports[0].constructor.name === 'Test', 'correct constructor Test');
    assert.ok(ports[1].constructor.name === 'Test2', 'correct constructor Test2');
    return stop();
});

tap.test('main array', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: [
            {
                layer1: [
                    ({utPort}) => class Test extends utPort {},
                    ({utPort}) => class Test2 extends utPort {}
                ]
            },
            {
                layer2: [
                    ({utPort}) => class Test3 extends utPort {}
                ]
            }
        ],
        config: {}
    });
    assert.ok(ports.length === 3, '3 ports');
    assert.ok(ports[0].constructor.name === 'Test', 'correct constructor Test');
    assert.ok(ports[1].constructor.name === 'Test2', 'correct constructor Test2');
    assert.ok(ports[2].constructor.name === 'Test3', 'correct constructor Test3');
    return stop();
});
