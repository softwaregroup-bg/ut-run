var _ = require('lodash');
module.exports = {
    console: {
        create: 'ut-port-console',
        init: 'init',
        properties: {
            config: {
                host: {$ref: 'config.console.host'},
                port: {$ref: 'config.console.port'}
            }
        },
        ready:'start'
    },
    log: {
        create: {
            module: 'ut-log',
            args: {
                type: 'bunyan',
                name: 'bunyan_test',
                streams: _.union([
                    {
                        level: 'trace',
                        stream: 'process.stdout'
                    },
                    {
                        level: 'trace',
                        stream: {
                            create: {
                                module:'ut-log/socketStream',
                                args:{
                                    host: {'$ref': 'config.console.host'},
                                    port: {'$ref': 'config.console.port'},
                                    objectMode: true
                                }
                            }
                        },
                        type: 'raw'
                    }
                ], {$ref: 'config.logStreams'})
            }
        }
    }
}
