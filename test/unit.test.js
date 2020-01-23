const tap = require('tap');
const utRun = require('..');

tap.test('main function', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: ({utPort}) => class Test extends utPort {},
        config: {}
    });
    try {
        assert.ok(ports.length === 1, 'exactly one port');
        assert.ok(ports[0].constructor.name === 'Test', 'correct constructor Test');
    } finally {
        await stop();
    }
});

tap.test('main object', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: {
            layer: [
                ({utPort}) => class Test1 extends utPort {},
                ({utPort}) => class Test2 extends utPort {}
            ]
        },
        config: {}
    });
    try {
        assert.ok(ports.length === 2, '2 ports');
        assert.ok(ports[0].constructor.name === 'Test1', 'correct constructor Test1');
        assert.ok(ports[1].constructor.name === 'Test2', 'correct constructor Test2');
    } finally {
        await stop();
    }
});

tap.test('main array', async(assert) => {
    const {ports, stop} = await utRun.run({
        method: 'unit',
        main: [
            () => ({
                layer1: () => [
                    ({utPort}) => class Test1 extends utPort {},
                    ({utPort}) => class Test2 extends utPort {}
                ],
                layer2: () => [
                    ({utPort}) => class Test21 extends utPort {},
                    ({utPort}) => class Test22 extends utPort {}
                ],
                layer3: [
                    ({utPort}) => class Test3 extends utPort {}
                ]
            }),
            function utModule() {
                return {
                    layer3: () => [
                        ({utPort}) => class Test4 extends utPort {}
                    ],
                    layer4: () => [
                        ({utPort}) => class Test41 extends utPort {}
                    ]
                };
            }
        ],
        config: {
            layer1: true,
            utModule: {
                layer3: true
            }
        }
    });
    try {
        assert.ok(ports.length === 4, '4 ports');
        assert.ok(ports[0].constructor.name === 'Test1', 'correct constructor Test1');
        assert.ok(ports[1].constructor.name === 'Test2', 'correct constructor Test2');
        assert.ok(ports[2].constructor.name === 'Test3', 'correct constructor Test3');
        assert.ok(ports[3].constructor.name === 'Test4', 'correct constructor Test4');
    } finally {
        await stop();
    }
});
