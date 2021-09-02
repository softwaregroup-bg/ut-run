const { resolve } = require('path');

module.exports = {
    implementation: require(resolve('package.json')).name.split('-', 2)[1],
    repl: false,
    utPort: {
        concurrency: 200
    },
    utBus: {
        serviceBus: {
            logLevel: 'debug',
            jsonrpc: {
                debug: true,
                host: 'localhost',
                port: 8090
            }
        }
    },
    run: {
        logLevel: 'debug'
    },
    adapter: true,
    utCore: true,
    utMicroservice: true
};
