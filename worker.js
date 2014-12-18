var wire = require('wire');

module.exports = wire({
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
