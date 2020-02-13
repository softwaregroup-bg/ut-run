const tap = require('tap');
const utRun = require('..');

function utModule1() {
    return {
        orchestrator: () => [
            function service({utMethod}) {
                return {
                    async 'service.entity.action'(params, $meta) {
                        return ['module1', ...await super['service.entity.action'](params, $meta)];
                    }
                };
            }
        ]
    };
};

function utModule2() {
    return {
        orchestrator: () => [
            function service({utMethod}) {
                return {
                    async 'service.entity.action'(params, $meta) {
                        return ['module2', ...await super['service.entity.action'](params, $meta)];
                    }
                };
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
                        namespace: ['service'],
                        imports: ['utModule1.service', 'utModule2.service']
                    };
                }

                get handlers() {
                    return {
                        'service.entity.action': async function(params, $meta) {
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
    t.test('service.entity.action', async t => {
        t.matchSnapshot(await app.serviceBus.importMethod('service.entity.action')(['test']));
    });
    t.test('stop', () => app.stop());
});
