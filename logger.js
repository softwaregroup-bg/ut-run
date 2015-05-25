module.exports={
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
    socketStream:{
        create: {
            module:'ut-log/socketStream',
            args:{
                host: {$ref: 'config.console.host'},
                port: {$ref: 'config.console.port'},
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
    }
}
