//(function(define) { define(function(require) {

module.exports = {
    socketStream:{
        create: {
            module:'ut-log/socketStream',
            args:{
                host: {$ref: 'consoleHost'},
                port: {$ref: 'consolePort'},
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
            serverPort: {$ref: 'clientPort'},
            clientPort: {$ref: 'serverPort'},
            logLevel: 'trace',
            id:'worker',
            logFactory:{$ref:'log'}
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
};

//});})(typeof define === 'function' && define.amd ?  define : function(factory) { module.exports = factory(require); });