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

        if (!process.browser && !mergedConfig.workDir){
            if (!mergedConfig.implementation) {
                throw new Error('Missing implementation ID in config');
            }
            var fsp = serverRequire('fs-plus');
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((fsp.getAppDataDirectory() || process.cwd()), mergedConfig.implementation);
        }

        require('when/monitor/console');

        var Bus = require('ut-bus');
        var log;
        var consolePort;

        if (config.log === false) {
            log = null
        } else {
            var UTLog = require('ut-log');
            var SocketStream = require('ut-log/socketStream');
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
        }
        if (mergedConfig.console !== false) {
            var Console = serverRequire('ut-port-console');
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
        var workerRun = _.assign(require('./index'), {
            bus: workerBus,
            logFactory: log
        });

        if (config.repl !== false) {
            var repl = serverRequire('repl').start({prompt: '>'});
            repl.context.app = app = {masterBus: masterBus, workerBus: workerBus, workerRun: workerRun};
        }
        consolePort && when(consolePort.init()).then(consolePort.start());
        return masterBus.init()
            .then(workerBus.init.bind(workerBus))
            .then(mergedConfig.masterBus.socket ? masterBus.start.bind(masterBus) : workerBus.start.bind(workerBus))
            .then(workerRun.ready.bind(workerRun))
            .then(workerRun.loadImpl.bind(workerRun, impl, mergedConfig));
    }
}
