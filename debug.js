/* eslint no-process-env:0 */

var merge = require('lodash.merge');
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
        var mergedConfig = merge({
            masterBus: {
                logLevel: 'debug',
                socket: 'bus'
            },
            workerBus: {
                logLevel: 'debug'
            },
            console: {
                host: '127.0.0.1',
                port: 30001
            },
            log: {
                streams: []
            },
            stdOut: {
                mode: 'dev'
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
            var streams = [];
            if (mergedConfig.stdOut) {
                streams.push({
                    level: 'trace',
                    stream: 'process.stdout',
                    streamConfig: mergedConfig.stdOut
                });
            }
            if (mergedConfig.console) {
                streams.push({
                    level: 'trace',
                    stream: require('ut-log/socketStream'),
                    streamConfig: {
                        protocol: process.browser && global.location.protocol,
                        host: mergedConfig.console.host,
                        port: mergedConfig.console.port,
                        objectMode: true
                    },
                    type: 'raw'
                });
            }
            log = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                workDir: mergedConfig.workDir,
                streams: Array.prototype.concat(streams, mergedConfig.log.streams)
            });
        }
        if (mergedConfig.console && mergedConfig.console.server) {
            var Console = serverRequire('ut-port-console');
            consolePort = new Console();
            merge(consolePort.config, mergedConfig.console);
        }
        if (mergedConfig.performance) {
            var Performance = serverRequire('ut-port-performance')(Port);
            performancePort = new Performance();
            merge(performancePort.config, mergedConfig.performance);
        }
        var masterBus = Object.assign(new Bus(), {
            server: true,
            logLevel: mergedConfig.masterBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'master',
            logFactory: log,
            performance: performancePort
        });
        var workerBus = Object.assign(new Bus(), {
            server: false,
            logLevel: mergedConfig.workerBus.logLevel,
            socket: mergedConfig.masterBus.socket,
            id: 'worker',
            logFactory: log,
            performance: performancePort
        });
        var workerRun = Object.assign({}, require('./index'), {
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
