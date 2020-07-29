const dispatch = require('ut-function.dispatch');
const {promisify} = require('util');

const exec = async => (...params) => {
    const [moduleName, fn] = params.pop().method.split('.', 2);
    const mod = require(moduleName);
    const result = mod && mod[fn];
    return typeof result === 'function'
        ? (async ? promisify(result) : result).apply(mod, params)
        : result;
};

require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'os.cpus': exec(),
                'process.resourceUsage': exec(),
                'dns.lookup': exec(true)
            })
        ]
    }],
    config: {
        implementation: 'api',
        utBus: {serviceBus: {jsonrpc: {domain: true}}}
    }
});
