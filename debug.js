var assign = require('lodash/object/assign');
var union = require('lodash/array/union');
var when = require('when');
var serverRequire = require;//hide some of the requires from lasso

function getDataDirectory() {
    switch (process.platform) {
        case 'darwin':
            return  path.join(process.env.HOME , 'Library/Application Support');
        case 'linux':
            return '/var/lib';
        case 'win32':
            return process.env.ProgramData;
        default:
            return null;
    }
}

module.exports = {
    start: function (impl, config) {
        var mergedConfig = assign({
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
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree' , mergedConfig.implementation);
        }

        require('when/monitor/console');

        var Bus = require('ut-bus');
        var log;
        var consolePort;
        var performancePort;

        if (config.log === false) {
            log = null
        } else {
            var UTLog = require('ut-log');
            var SocketStream = require('ut-log/socketStream');
            log = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                workDir: mergedConfig.workDir,
                streams: union([{
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
            consolePort = assign(new Console(), {config: mergedConfig.console});
        }
        if (mergedConfig.performance) {
            var Performance = require('ut-port-performance');
            performancePort = assign(new Performance(), {config: mergedConfig.performance});
        }
        var masterBus = assign(new Bus(), {
            server: true,
            logLevel: mergedConfig.masterBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'master',
            logFactory: log,
            performance: performancePort
        });
        var workerBus = assign(new Bus(), {
            server: false,
            logLevel: mergedConfig.workerBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'worker',
            logFactory: log,
            performance: performancePort
        });
        var workerRun = assign(require('./index'), {
            bus: workerBus,
            logFactory: log
        });

        if (config.repl !== false) {
            var repl = serverRequire('repl').start({prompt: '>'});
            repl.context.app = app = {masterBus: masterBus, workerBus: workerBus, workerRun: workerRun};
        }
        consolePort && when(consolePort.init()).then(consolePort.start());
        performancePort && when(performancePort.init()).then(performancePort.start());
        return masterBus.init()
            .then(workerBus.init.bind(workerBus))
            .then(mergedConfig.masterBus.socket ? masterBus.start.bind(masterBus) : workerBus.start.bind(workerBus))
            .then(workerRun.ready.bind(workerRun))
            .then(workerRun.loadImpl.bind(workerRun, impl, mergedConfig));
    }
}
