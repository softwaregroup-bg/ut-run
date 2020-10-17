const tap = require('tap');
const utRun = require('..');

function utModule1() {
    const handlerFactory = ut => ({
        async 'subject.object.predicate'(params, $meta) {
            return ['module1', ...await super['subject.object.predicate'](params, $meta)];
        }
    });
    return {
        orchestrator: () => [
            function subject() {
                return [handlerFactory];
            }
        ]
    };
};

function utModule2() {
    const handlerFactory = ut => ({
        async 'subject.object.predicate'(params, $meta) {
            return ['module2', ...await super['subject.object.predicate'](params, $meta)];
        }
    });
    return {
        orchestrator: () => [
            function subject() {
                return [handlerFactory];
            }
        ]
    };
};

function utModule3() {
    return {
        orchestrator: () => [
            (...params) => class script extends require('ut-port-script')(...params) {
                get defaults() {
                    return {
                        namespace: ['subject'],
                        imports: ['utModule1.subject', 'utModule2.subject']
                    };
                }

                get handlers() {
                    return {
                        async 'subject.object.predicate'(params, $meta) {
                            return ['root'];
                        }
                    };
                }
            }
        ]
    };
};

tap.test('Method override', async t => {
    const app = await utRun.run({
        main: [
            utModule1,
            utModule2,
            utModule3
        ],
        config: {
            implementation: 'test',
            repl: false,
            run: { logLevel: 'debug' },
            utPort: { logLevel: 'debug' },
            utLog: false,
            utBus: { serviceBus: { jsonrpc: {domain: true} } },
            utModule1: { orchestrator: true },
            utModule2: { orchestrator: true },
            utModule3: { orchestrator: true },
            script: true
        }
    });
    t.test('subject.object.predicate', async t => {
        t.matchSnapshot(await app.serviceBus.importMethod('subject.object.predicate')(['test']));
    });
    t.test('stop', () => app.stop());
});
