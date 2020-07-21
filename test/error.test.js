const tap = require('tap');
const dispatch = require('ut-function.dispatch');
const utRun = require('..');

function utFoo() {
    return {
        orchestrator: () => [
            function error({registerErrors}) {
                return registerErrors({
                    'foo.simple': 'Module foo simple error',
                    'foo.properties': {
                        message: 'Module foo error with additional properties',
                        statusCode: 400
                    }
                });
            }
        ]
    };
};

function utBar() {
    return {
        orchestrator: () => [
            function error({registerErrors}) {
                return registerErrors({
                    'bar.simple': 'Module bar simple error',
                    'bar.parametrized': 'Module bar parametrized error: {name}'
                });
            }
        ]
    };
};

function utTest() {
    return {
        orchestrator: () => [
            function({
                import: {
                    errorFooSimple,
                    errorFooProperties,
                    errorBarSimple,
                    errorBarParametrized
                }
            }) {
                return dispatch({
                    namespace: 'test',
                    methods: {
                        'test.error.throw'(type) {
                            try {
                                switch (type) {
                                    case 'errorFooSimple': throw errorFooSimple();
                                    case 'errorFooProperties': throw errorFooProperties();
                                    case 'errorBarSimple': throw errorBarSimple(new Error('root'));
                                    case 'errorBarParametrized': throw errorBarParametrized({params: {name: 'value'}});
                                }
                            } catch (error) {
                                return {...error};
                            }
                        }
                    }
                })(...arguments);
            }
        ]
    };
};

tap.test('Error import', async t => {
    const app = await utRun.run({
        main: [
            utFoo,
            utBar,
            utTest // can only import errors from previous modules
        ],
        config: {
            implementation: 'test',
            repl: false,
            run: { logLevel: 'trace' },
            utPort: { logLevel: 'trace' },
            utLog: false,
            utBus: { serviceBus: { jsonrpc: {domain: true} } },
            utFoo: { orchestrator: true },
            utBar: { orchestrator: true },
            utTest: { orchestrator: true }
        }
    });
    const error = app.serviceBus.importMethod('test.error.throw');
    t.test('test.error.throw', async t => {
        t.matchSnapshot(await error('errorFooSimple'), 'module foo simple error');
        t.matchSnapshot(await error('errorFooProperties'), 'error with properties');
        t.matchSnapshot(await error('errorBarSimple'), 'module bar simple error');
        t.matchSnapshot(await error('errorBarParametrized'), 'parametrized error message');
    });
    t.test('stop', () => app.stop());
});
