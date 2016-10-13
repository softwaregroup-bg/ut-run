/* eslint no-process-env:0 */

var assign = require('lodash.assign');
var union = require('lodash.union');
var when = require('when');
var serverRequire = require;// hide some of the requires from lasso
var path = require('path');

function getDataDirectory() {
    switch (process.platform) {
        case 'darwin':
            return path.join(process.env.HOME, 'Library/Application Support');
        case 'linux':
            return '/var/lib';
        case 'win32':
            return process.env.ProgramData;
        default:
            return null;
    }
}

module.exports = {
    debug: function(impl, config) {
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

        if (!process.browser && !mergedConfig.workDir) {
            if (!mergedConfig.implementation) {
                throw new Error('Missing implementation ID in config');
            }
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree', mergedConfig.implementation);
        }

        require('when/monitor/console');

        var Bus = require('ut-bus');
        var Port = require('ut-bus/port');
        var log;
        var consolePort;
        var performancePort;

        if (config.log === false) {
            log = null;
        } else {
            var UTLog = require('ut-log');
            log = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                workDir: mergedConfig.workDir,
                streams: union([{
                    level: 'trace',
                    stream: 'process.stdout',
                    streamConfig: mergedConfig.stdOut
                }, {
                    level: 'trace',
                    stream: require('ut-log/socketStream'),
                    streamConfig: {
                        protocol: process.browser && global.location.protocol,
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
            consolePort = new Console();
            assign(consolePort.config, mergedConfig.console);
        }
        if (mergedConfig.performance) {
            var Performance = serverRequire('ut-port-performance')(Port);
            performancePort = new Performance();
            assign(performancePort.config, mergedConfig.performance);
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
        var workerRun = assign({}, require('./index'), {
            bus: workerBus,
            logFactory: log
        });

        if (config.repl !== false) {
            var repl = serverRequire('repl').start({prompt: 'ut>'});
            repl.context.app = global.app = {masterBus: masterBus, workerBus: workerBus, workerRun: workerRun};
        }
        consolePort && when(consolePort.init()).then(consolePort.start());
        performancePort && when(performancePort.init()).then(performancePort.start());
        return masterBus.init()
            .then(workerBus.init.bind(workerBus))
            .then(mergedConfig.masterBus.socket ? masterBus.start.bind(masterBus) : workerBus.start.bind(workerBus))
            .then(workerRun.ready.bind(workerRun))
            .then(workerRun.loadImpl.bind(workerRun, impl, mergedConfig))
            .then(function(ports) {
                return {
                    ports: ports,
                    master: masterBus,
                    bus: workerBus,
                    log: log,
                    config: mergedConfig,
                    stop: () => {
                        var promise = Promise.resolve();
                        ports
                            .map((port) => port.stop.bind(port))
                            .concat(workerBus.destroy.bind(workerBus))
                            .concat(masterBus.destroy.bind(masterBus))
                            .forEach((method) => (promise = promise.then(() => method())));
                        return promise;
                    }
                };
            })
            .catch((err) => {
                workerBus.destroy();
                masterBus.destroy();
                return Promise.reject(err);
            });
    }
};
