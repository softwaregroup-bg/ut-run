/* eslint no-process-env:0 */

var merge = require('lodash.merge');
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
    debug: function(serviceConfig, envConfig, assert) {
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
                port: 30001,
                logLevel: 'info'
            },
            log: {
                streams: []
            },
            stdOut: {
                mode: 'dev'
            },
            runMaster: true,
            runWorker: true
        }, envConfig);

        if (!process.browser && !mergedConfig.workDir) {
            if (!mergedConfig.implementation) {
                throw new Error('Missing implementation ID in config');
            }
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree', mergedConfig.implementation);
        }

        var Bus = require('ut-bus');
        var logFactory;
        var log;

        if (envConfig.log === false || envConfig.log === 'false') {
            logFactory = null;
        } else {
            var UTLog = require('ut-log');
            var streams = [];
            if (mergedConfig.stdOut) {
                streams.push({
                    level: mergedConfig.stdOut.level || 'trace',
                    stream: 'process.stdout',
                    streamConfig: mergedConfig.stdOut
                });
            }
            if (mergedConfig.console) {
                streams.push({
                    level: mergedConfig.console.level || 'trace',
                    stream: require('ut-log/udpStream'),
                    streamConfig: {
                        host: mergedConfig.console.host,
                        port: mergedConfig.console.port
                    }
                });
            }
            logFactory = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                service: mergedConfig.service,
                workDir: mergedConfig.workDir,
                transformData: (mergedConfig.log && (mergedConfig.log.transformData || {})),
                streams: Array.prototype.concat(streams, mergedConfig.log.streams)
            });

            log = logFactory.createLog((mergedConfig && mergedConfig.run && mergedConfig.run.logLevel) || 'info', {name: 'run', context: 'run'});
            log && log.info && log.info({
                $meta: {mtid: 'event', opcode: 'run.debug'},
                config: mergedConfig.config,
                runMaster: mergedConfig.runMaster,
                runWorker: mergedConfig.runWorker,
                repl: mergedConfig.repl
            });
        }
        var masterBus;
        var workerBus;
        var service;

        if (mergedConfig.masterBus.socketPid) {
            if (mergedConfig.masterBus.socket) {
                mergedConfig.masterBus.socket = mergedConfig.masterBus.socket + '[' + process.pid + ']';
            } else {
                mergedConfig.masterBus.socket = process.pid;
            }
        }

        if (mergedConfig.runMaster) {
            masterBus = Object.assign(new Bus(), {
                server: true,
                logLevel: mergedConfig.masterBus.logLevel,
                socket: mergedConfig.masterBus.socket,
                id: 'master',
                logFactory: logFactory
            });
        }

        if (mergedConfig.runWorker) {
            workerBus = Object.assign(new Bus(), {
                server: false,
                logLevel: mergedConfig.workerBus.logLevel,
                socket: mergedConfig.masterBus.socket,
                id: 'worker',
                logFactory: logFactory
            });
            service = require('./service')({
                bus: workerBus,
                logFactory,
                assert
            });
        }

        if (envConfig.repl !== false) {
            var repl = serverRequire('repl').start({prompt: 'ut>'});
            repl.context.app = global.app = {masterBus: masterBus, workerBus: workerBus, service};
        }

        var promise = Promise.resolve();
        if (masterBus) {
            promise = promise.then(masterBus.init.bind(masterBus));
        }
        if (workerBus) {
            promise = promise.then(workerBus.init.bind(workerBus));
            if (masterBus && mergedConfig.masterBus.socket) {
                promise = promise.then(masterBus.start.bind(masterBus));
            } else {
                promise = promise.then(workerBus.start.bind(workerBus));
            }
            promise = promise
                .then(() => service.create(serviceConfig, mergedConfig, assert))
                .then(() => service.start());
        } else {
            promise = promise
            .then(masterBus.start.bind(masterBus))
            .then(() => ([])); // no ports
        }
        return promise
            .then(function(ports) {
                return {
                    ports: ports,
                    portsMap: ports.reduce((prev, cur) => {
                        if (cur && cur.config && (typeof cur.config.id === 'string')) {
                            prev[cur.config.id] = cur;
                        }
                        return prev;
                    }, {}),
                    master: masterBus,
                    bus: workerBus,
                    log: logFactory,
                    config: mergedConfig,
                    stop: () => {
                        let innerPromise = Promise.resolve();
                        ports
                            .map((port) => port.stop.bind(port))
                            .concat(workerBus ? workerBus.destroy.bind(workerBus) : [])
                            .concat(masterBus ? masterBus.destroy.bind(masterBus) : [])
                            .forEach((method) => (innerPromise = innerPromise.then(() => method())));
                        return innerPromise;
                    }
                };
            })
            .catch((err) => {
                workerBus && workerBus.destroy();
                masterBus && masterBus.destroy();
                return Promise.reject(err);
            });
    }
};
