/* eslint no-process-env:0 */

const merge = require('ut-port/merge');
const serverRequire = require;// hide some of the requires from lasso
const path = require('path');
const {Broker, ServiceBus} = require('ut-bus');

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
            utLog: {
                streams: {
                    stdOut: {
                        level: 'trace',
                        stream: 'process.stdout',
                        type: 'raw',
                        streamConfig: {
                            mode: 'dev'
                        }
                    },
                    udp: {
                        level: 'trace',
                        stream: '../udpStream',
                        streamConfig: {
                            host: 'localhost',
                            port: 30001
                        }
                    }
                }
            },
            utBus: {}
        }, envConfig);

        if (mergedConfig.utBus.broker) {
            mergedConfig.utBus.broker = merge({
                id: 'broker',
                logLevel: 'info',
                socket: (mergedConfig.implementation && mergedConfig.service) ? `${mergedConfig.implementation + '-' + mergedConfig.service}` : 'bus'
            }, mergedConfig.utBus.broker);
        }
        if (mergedConfig.utBus.broker && mergedConfig.utBus.broker.socketPid) {
            if (mergedConfig.utBus.broker.socket) {
                mergedConfig.utBus.broker.socket = mergedConfig.utBus.broker.socket + '[' + process.pid + ']';
            } else {
                mergedConfig.utBus.broker.socket = process.pid;
            }
        }
        if (mergedConfig.utBus.serviceBus) {
            mergedConfig.utBus.serviceBus = merge({
                id: 'serviceBus',
                logLevel: 'info',
                channel: envConfig.implementation,
                socket: mergedConfig.utBus.broker ? mergedConfig.utBus.broker.socket : true
            }, mergedConfig.utBus.serviceBus);

            if (!mergedConfig.utBus.broker && mergedConfig.utBus.serviceBus.socketPid && mergedConfig.utBus.serviceBus.socket) {
                mergedConfig.utBus.serviceBus.socket = mergedConfig.utBus.serviceBus.socket + '[' + process.pid + ']';
            }
        }

        if (!process.browser && !mergedConfig.workDir) {
            if (!mergedConfig.implementation) {
                throw new Error('Missing implementation ID in config');
            }
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree', mergedConfig.implementation);
        }

        var logFactory;
        var log;

        if (mergedConfig.log === false || mergedConfig.log === 'false' || !mergedConfig.utLog || mergedConfig.utLog === 'false') {
            logFactory = null;
        } else {
            var UTLog = require('ut-log');
            logFactory = new UTLog({
                type: 'bunyan',
                name: 'bunyan_test',
                service: mergedConfig.service,
                workDir: mergedConfig.workDir,
                version: mergedConfig.version,
                env: mergedConfig.params && mergedConfig.params.env,
                transformData: (mergedConfig.utLog && (mergedConfig.utLog.transformData || {})),
                streams: Object.values(mergedConfig.utLog.streams)
            });

            log = logFactory.createLog((mergedConfig && mergedConfig.run && mergedConfig.run.logLevel) || 'info', {name: 'run', context: 'run'});
            log && log.info && log.info({
                $meta: {mtid: 'event', opcode: 'run.debug'},
                config: {
                    path: mergedConfig.config
                },
                utBus: mergedConfig.utBus,
                utLog: mergedConfig.utLog,
                repl: mergedConfig.repl
            });
        }
        var broker;
        var serviceBus;
        var service;

        if (mergedConfig.utBus.broker) {
            broker = new Broker(Object.assign({logFactory}, mergedConfig.utBus.broker));
        }

        if (mergedConfig.utBus.serviceBus) {
            serviceBus = new ServiceBus(Object.assign({logFactory}, mergedConfig.utBus.serviceBus));
            service = require('./service')({
                serviceBus,
                logFactory,
                assert,
                log
            });
        }

        if (envConfig.repl !== false && envConfig.repl !== 'false') {
            var repl = serverRequire('repl').start({prompt: 'ut>'});
            repl.context.app = global.app = {broker, serviceBus, service};
        }

        var promise = Promise.resolve();
        if (broker) {
            promise = promise.then(broker.init.bind(broker));
        }
        if (serviceBus) {
            promise = promise.then(serviceBus.init.bind(serviceBus));
            if (broker) {
                promise = promise.then(broker.start.bind(broker));
            }
            promise = promise
                .then(serviceBus.start.bind(serviceBus))
                .then(() => service.create(serviceConfig, mergedConfig, assert))
                .then(created => service.start(created));
        } else {
            promise = promise
                .then(broker.start.bind(broker))
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
                    broker,
                    serviceBus,
                    log: logFactory,
                    config: mergedConfig,
                    stop: () => {
                        let innerPromise = Promise.resolve();
                        ports
                            .map((port) => port.destroy.bind(port))
                            .concat(serviceBus ? serviceBus.destroy.bind(serviceBus) : [])
                            .concat(broker ? broker.destroy.bind(broker) : [])
                            .forEach((method) => (innerPromise = innerPromise.then(() => method())));
                        return innerPromise;
                    }
                };
            })
            .catch((err) => {
                serviceBus && serviceBus.destroy();
                broker && broker.destroy();
                return Promise.reject(err);
            });
    }
};
