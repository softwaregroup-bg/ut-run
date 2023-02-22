/* eslint no-process-env:0 */
const merge = require('ut-function.merge');
const path = require('path');
const {Broker, ServiceBus} = require('ut-bus');
const through2 = require('through2');
const joi = require('joi');

function getDataDirectory() {
    if (process.browser) return '/';
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

module.exports = function(envConfig, vfs) {
    const mergedConfig = merge({
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
                udp: !process.browser && !require('./serverRequire').utCompile && {
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
            service: mergedConfig.service,
            socket: mergedConfig.utBus.broker ? mergedConfig.utBus.broker.socket : true
        }, mergedConfig.utBus.serviceBus);

        if (!mergedConfig.utBus.broker && mergedConfig.utBus.serviceBus.socketPid && mergedConfig.utBus.serviceBus.socket) {
            mergedConfig.utBus.serviceBus.socket = mergedConfig.utBus.serviceBus.socket + '[' + process.pid + ']';
        }
    }

    if (!mergedConfig.workDir) {
        if (!mergedConfig.implementation) {
            throw new Error('Missing implementation ID in config');
        }
        mergedConfig.workDir = path.join((getDataDirectory() || process.cwd()), 'SoftwareGroup', 'UnderTree', mergedConfig.implementation);
    }

    let logFactory;
    let log;
    let serviceBus;

    if (mergedConfig.log === false || mergedConfig.log === 'false' || !mergedConfig.utLog || mergedConfig.utLog === 'false') {
        logFactory = null;
    } else {
        if (mergedConfig.utLog.streams.utNotice) {
            mergedConfig.utLog.streams.utNotice = {
                type: 'raw',
                level: 'error',
                streamConfig: {
                    objectMode: true,
                    method: 'notice.message.log'
                },
                stream: ({method, ...config}, options) => {
                    let notice;
                    return through2(config, async(message, enc, done) => {
                        if (!notice) notice = serviceBus && serviceBus.publicApi.importMethod(method);
                        try {
                            if (notice && message.jsException && message.jsException.notice) {
                                await notice(message);
                            }
                        } catch (error) {
                        }
                        done();
                    });
                },
                ...mergedConfig.utLog.streams.utNotice
            };
        }
        const UTLog = require('ut-log');
        logFactory = new UTLog({
            type: 'bunyan',
            name: 'bunyan_test',
            service: mergedConfig.service,
            workDir: mergedConfig.workDir,
            version: mergedConfig.version,
            impl: mergedConfig.implementation,
            location: mergedConfig.location,
            env: mergedConfig.params && mergedConfig.params.env,
            udf: mergedConfig.utLog.udf,
            transformData: mergedConfig.utLog.transformData,
            maxFieldLength: mergedConfig.utLog.maxFieldLength,
            maxArrayLength: mergedConfig.utLog.maxArrayLength,
            maxBufferLength: mergedConfig.utLog.maxBufferLength,
            streams: Object.values(mergedConfig.utLog.streams)
        });

        log = logFactory.createLog((mergedConfig && mergedConfig.run && mergedConfig.run.logLevel) || 'info', {name: 'run', context: 'run'});
        log && log.info && log.info({
            $meta: {mtid: 'event', method: 'run.debug'},
            config: {
                path: mergedConfig.config
            },
            utBus: mergedConfig.utBus,
            utLog: mergedConfig.utLog,
            repl: mergedConfig.repl
        });
    }
    let broker;
    let service;
    const busContext = {joi, logFactory, version: mergedConfig.version};
    if (mergedConfig.utBus.broker) {
        broker = new Broker({ workDir: path.join(mergedConfig.workDir, 'broker'), ...busContext, ...mergedConfig.utBus.broker});
    }

    if (mergedConfig.utBus.serviceBus) {
        serviceBus = new ServiceBus({workDir: path.join(mergedConfig.workDir, 'serviceBus'), ...busContext, ...mergedConfig.utBus.serviceBus});
        service = require('./service')({
            serviceBus,
            logFactory,
            log,
            vfs
        });
    }

    if (!process.browser && envConfig.repl !== false && envConfig.repl !== 'false') {
        const repl = require('./serverRequire')('repl').start({prompt: 'ut>'});
        repl.context.app = global.app = {broker, serviceBus, service};
    }

    let promise = Promise.resolve();
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
            .then(() => ({broker, serviceBus, service, mergedConfig, logFactory, log}));
    } else {
        promise = promise
            .then(broker.start.bind(broker))
            .then(() => ({broker, mergedConfig, logFactory, log})); // no services
    }
    return promise;
};
