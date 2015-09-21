var _ = require('lodash');
var when = require('when');
var serverRequire = require;//hide some of the requires from lasso

module.exports = {
    start: function (impl, config) {
        var mergedConfig = _.assign({
            masterBus: {
                logLevel: 'debug',
                socket: 'bus'
            },
            workerBus: {
                logLevel: 'debug'
            },
            console: {
                host: '0.0.0.0',
                port: 30001
            },
            log: {
                streams: []
            }
        }, config);

        require('when/monitor/console');

        var Bus = require('ut-bus');
        var log;
        var consolePort;

        if (config.log === false) {
            log = null
        } else {
            var UTLog = serverRequire('ut-log');
            var SocketStream = serverRequire('ut-log/socketStream');
            var Console = serverRequire('ut-port-console');
            log = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                streams: _.union([{
                    level: 'trace',
                    stream: 'process.stdout'
                }, {
                    level: 'trace',
                    stream: '../socketStream',
                    streamConfig:{
                        host: mergedConfig.console.host,
                        port: mergedConfig.console.port,
                        objectMode: true
                    },
                    type: 'raw'
                }], mergedConfig.log.streams)
            });
            consolePort = _.assign(new Console(), {
                config: {
                    host: mergedConfig.console.host,
                    port: mergedConfig.console.port,
                }
            });
        }
        var masterBus = _.assign(new Bus(), {
            server: true,
            logLevel: mergedConfig.masterBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'master',
            logFactory: log
        });
        var workerBus = _.assign(new Bus(), {
            server: false,
            logLevel: mergedConfig.workerBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'worker',
            logFactory: log
        });
        var workerRun = _.assign(require('.'), {
            bus: workerBus,
            logFactory: log
        });

        if (config.repl !== false) {
            var repl = serverRequire('repl').start({prompt: '>'});
            repl.context.app = app = {masterBus: masterBus, workerBus: workerBus, workerRun: workerRun};
        }
        consolePort && consolePort.init();
        masterBus.init()
            .then(workerBus.init.bind(workerBus))
            .then(masterBus.start.bind(masterBus))
            .then(workerRun.ready.bind(workerRun))
            .then(workerRun.loadImpl.bind(workerRun, impl, config));
    }
}
