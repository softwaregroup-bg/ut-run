var wire = require('wire');

module.exports = wire({
    host: '0.0.0.0',
    port: 30001,
    console: {
        create: 'ut-port-console',
        init: 'init',
        properties: {
            config: {
                host: {$ref: 'host'},
                port: {$ref: 'port'}
            }
        },
        ready:'start'
    },
    socketStream:{
        create: {
            module:'ut-log/socketStream',
            args:{
                host: {$ref: 'host'},
                port: {$ref: 'port'},
                objectMode: true
            }
        }
    },
    log: {
        create: {
            module: 'ut-log',
            args: {
                type: 'bunyan',
                name: 'bunyan_test',
                streams: [
                    {
                        level: 'trace',
                        stream: 'process.stdout'
                    },
                    {
                        level: 'trace',
                        stream: {$ref:'socketStream'},
                        type: 'raw'
                    }
                ]
            }
        }
    },
    bus: {
        create: 'ut-bus',
        init: 'init',
        properties: {
            serverPort: 3001,
            clientPort: 3000
        }
    },
    run: {
        module: 'ut-run',
        ready: 'ready',
        properties: {
            bus: {$ref: 'bus'},
            wire: {$ref: 'wire!'}
        }
    }
}, {require: require});
