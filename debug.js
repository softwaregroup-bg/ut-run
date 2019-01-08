/* eslint no-process-env:0 */

const merge = require('ut-port/merge');
const serverRequire = require;// hide some of the requires from lasso
const path = require('path');
const {Broker, Bus} = require('ut-bus');

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
            broker: {
                logLevel: 'debug',
                socket: 'bus'
            },
            bus: {
                logLevel: 'debug',
                channel: envConfig.implementation
            },
            console: {
                host: 'localhost',
                port: 30001,
                logLevel: 'info'
            },
            log: {
                streams: {}
            },
            stdOut: {
                mode: 'dev'
            },
            runBroker: true,
            runBus: true
        }, envConfig);

        if (!process.browser && !mergedConfig.workDir) {
            if (!mergedConfig.implementation) {
                throw new Error('Missing implementation ID in config');
            }
            var path = serverRequire('path');
            mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree', mergedConfig.implementation);
        }

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
                    type: 'raw',
                    streamConfig: mergedConfig.stdOut
                });
            }
            if (mergedConfig.console && mergedConfig.console !== 'false') {
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
                version: mergedConfig.version,
                env: mergedConfig.params && mergedConfig.params.env,
                transformData: (mergedConfig.log && (mergedConfig.log.transformData || {})),
                streams: Array.prototype.concat(streams, Object.values(mergedConfig.log.streams))
            });

            log = logFactory.createLog((mergedConfig && mergedConfig.run && mergedConfig.run.logLevel) || 'info', {name: 'run', context: 'run'});
            log && log.info && log.info({
                $meta: {mtid: 'event', opcode: 'run.debug'},
                config: mergedConfig.config,
                runBroker: mergedConfig.runBroker,
                runBus: mergedConfig.runBus,
                repl: mergedConfig.repl
            });
        }
        var broker;
        var bus;
        var service;

        if (mergedConfig.broker.socketPid) {
            if (mergedConfig.broker.socket) {
                mergedConfig.broker.socket = mergedConfig.broker.socket + '[' + process.pid + ']';
            } else {
                mergedConfig.broker.socket = process.pid;
            }
        }

        if (mergedConfig.runBroker) {
            broker = new Broker({
                logLevel: mergedConfig.broker.logLevel,
                socket: mergedConfig.broker.socket,
                id: 'broker',
                logFactory: logFactory
            });
        }

        if (mergedConfig.runBus) {
            bus = new Bus({
                logLevel: mergedConfig.bus.logLevel,
                socket: mergedConfig.broker.socket,
                channel: mergedConfig.bus.channel,
                hemera: mergedConfig.bus.hemera,
                jsonrpc: mergedConfig.bus.jsonrpc,
                moleculer: mergedConfig.bus.moleculer,
                id: 'bus',
                logFactory: logFactory
            });
            service = require('./service')({
                bus: bus,
                logFactory,
                assert,
                log
            });
        }

        if (envConfig.repl !== false && envConfig.repl !== 'false') {
            var repl = serverRequire('repl').start({prompt: 'ut>'});
            repl.context.app = global.app = {broker, bus, service};
        }

        var promise = Promise.resolve();
        if (broker) {
            promise = promise.then(broker.init.bind(broker));
        }
        if (bus) {
            promise = promise.then(bus.init.bind(bus));
            if (broker && mergedConfig.broker.socket) {
                promise = promise.then(broker.start.bind(broker));
            } else {
                promise = promise.then(bus.start.bind(bus));
            }
            promise = promise
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
                    broker: broker,
                    bus: bus,
                    log: logFactory,
                    config: mergedConfig,
                    stop: () => {
                        let innerPromise = Promise.resolve();
                        ports
                            .map((port) => port.destroy.bind(port))
                            .concat(bus ? bus.destroy.bind(bus) : [])
                            .concat(broker ? broker.destroy.bind(broker) : [])
                            .forEach((method) => (innerPromise = innerPromise.then(() => method())));
                        return innerPromise;
                    }
                };
            })
            .catch((err) => {
                bus && bus.destroy();
                broker && broker.destroy();
                return Promise.reject(err);
            });
    }
};
