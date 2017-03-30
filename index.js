/* eslint no-process-exit: 0, no-process-env:0, no-console:0 */

var when = require('when');
var merge = require('lodash.merge');
var serverRequire = require;// hide some of the requires from lasso
var run = require('./debug');
var rc = require('rc');

module.exports = {

    bus: null,
    config: null,
    logFactory: null,

    ready: function() {
        this.config = this.config || {};
        if (this.bus) {
            return this.bus.register({
                run: this.run.bind(this)
            });
        }
    },

    load: function(implementation, config) {
        if (typeof implementation === 'string') {
            implementation = require(implementation);
        }

        if (Array.isArray(implementation)) {
            implementation = implementation.reduce((prev, impl) => {
                impl.ports && (prev.ports = prev.ports.concat(impl.ports));
                impl.modules && Object.assign(prev.modules, impl.modules);
                impl.validations && Object.assign(prev.validations, impl.validations);
                return prev;
            }, {ports: [], modules: {}, validations: {}});
        }

        var ports = implementation.ports;
        var portsStarted = [];
        config = config || {};
        this.bus.config = config;

        if (implementation.modules instanceof Object) {
            Object.keys(implementation.modules).forEach(function(moduleName) {
                var module = implementation.modules[moduleName];
                (module.init instanceof Function) && (module.init(this.bus));
                module.routeConfig = [];
                this.bus.registerLocal(module, moduleName);
            }.bind(this));
        }

        if (implementation.validations instanceof Object) {
            Object.keys(implementation.validations).forEach(function(validationKey) {
                var routeConfigNames = validationKey.split('.');
                var moduleName = routeConfigNames.length > 1 ? routeConfigNames.shift() : routeConfigNames;
                var module = implementation.modules[moduleName];
                var routeConfig = implementation.validations[validationKey];
                module && Object.keys(routeConfig).forEach(function(value) {
                    module.routeConfig.push({
                        method: routeConfigNames.join('.') + '.' + value,
                        config: routeConfig[value]
                    });
                });
            });
        }

        return when.all(
            ports.reduce(function(all, port) {
                config[port.id] !== false && all.push(this.loadConfig(merge(port, config[port.id])));
                return all;
            }.bind(this), [])
        ).then(function(contexts) {
            return when.reduce(contexts, function(prev, context, idx) {
                portsStarted.push(context); // collect ports that are started
                return context.start();
            }, [])
            .then(function() {
                return contexts;
            })
            .catch(function(err) {
                return when.reduce(portsStarted.reverse(), function(prev, context, idx) {
                    return new Promise((resolve) => resolve(context.stop())).catch(() => true); // continue on error
                }, [])
                .then(() => Promise.reject(err)); // reject with the original error
            });
        });
    },

    loadImpl: function(implementation, config) {
        if (typeof implementation === 'function') {
            return new Promise(resolve => resolve(implementation({config})))
                .then(result => this.load(result, config));
        } else {
            return this.load(implementation, config);
        }
    },

    loadConfig: function(config) {
        var Port;
        if (config.createPort instanceof Function) {
            Port = config.createPort;
        } else {
            if (config.type) {
                throw new Error('Use createPort:require(\'ut-port-' + config.type + '\') instead of type:\'' + config.type + '\'');
            } else {
                throw new Error('Missing createPort property');
            }
        }
        var port = new Port();
        port.bus = this.bus;
        port.logFactory = this.logFactory;
        merge(port.config, config);
        return when(port.init()).then(function() {
            return port;
        });
    },

    runParams: function(params, parent) {
        parent = parent || module.parent;
        if (process.type === 'browser') {
            serverRequire('ut-front/electron')({main: parent.filename});
        } else {
            var config = params && params.config;
            if (!config) {
                config = {params: {}};
                var argv = require('minimist')(process.argv.slice(2));
                config.params.app = process.env.UT_APP || (params && params.app) || argv._[0] || 'server';
                config.params.method = process.env.UT_METHOD || (params && params.method) || argv._[1] || 'debug';
                config.params.runMaster = !(params && params.busType === 'worker');
                config.params.runWorker = !(params && params.busType === 'master');
                config.params.env = process.env.UT_ENV || (params && params.env) || argv._[2] || 'dev';
                config = Object.assign(config, parent.require('./' + config.params.app + '/' + config.params.env));
            }
            var main = (params && params.main) || parent.require('./' + config.params.app);

            config = rc(['ut', (config.implementation || 'ut5').replace(/-/g, '_'), process.env.UT_ENV || (params && params.env) || 'dev'].join('_'), config);

            if (config.cluster && config.masterBus && config.masterBus.socket && config.masterBus.socket.port) {
                var cluster = serverRequire('cluster');
                if (cluster.isMaster) {
                    var workerCount = config.cluster.workers || require('os').cpus().length;
                    for (var i = 0; i < workerCount; i += 1) {
                        cluster.fork();
                    }
                    return true;
                } else {
                    config.masterBus.socket.port = config.masterBus.socket.port + cluster.worker.id;
                    config.console && config.console.port && (config.console.port = config.console.port + cluster.worker.id);
                }
            }
            return run[(params && params.method) || config.params.method](main, config);
        }
    },
    run: function(params, parent) {
        return this.runParams(params, parent).catch((err) => {
            console.error(err);
            process.abort();
        });
    },
    runCluster: function(params, parent) {
        var path = serverRequire('path');
        var pm2 = serverRequire('pm2');
        var argv = serverRequire('minimist')(process.argv.slice(2));
        var debugPort = 6000;
        function getNodeArgs() {
            return process.execArgv.map(function(arg) {
                return arg.startsWith('--debug') ? '--debug=' + debugPort++ : arg;
            })
        }
        function getArgs(app) {
            return [app].concat(argv._)
        }
        function getEnv() {
            var env = {
                basePath: path.join(parent.filename, '..')
            }
            if (process.env.NODE_PATH) {
                env.NODE_PATH = path.resolve(process.env.NODE_PATH)
            }
            Object.keys(process.env).forEach((prop) => {
                if (prop.startsWith('UT_')) {
                    env[prop] = process.env[prop];
                }
            })
            return env;
        }
        var scripts = {
            master: path.resolve(__dirname, 'processes', 'master.js'),
            worker: path.resolve(__dirname, 'processes', 'worker.js')
        };
        return new Promise(function(resolve, reject) {
            pm2.connect(true, function(err) {
                if (err) {
                    console.error(err);
                    process.exit(2);
                }
                pm2.start({
                    name: 'master',
                    script: scripts.master,
                    node_args: getNodeArgs(),
                    args: getArgs('server'),
                    env: getEnv(),
                    max_memory_restart: '500M'
                }, function(err, apps) {
                    // pm2.disconnect();   // Disconnects from PM2
                    return err ? console.error(err) : console.log(apps);
                })
            });
            pm2.launchBus(function(err, bus) {
                bus.on('process:master', function(packet) {
                    if (packet.data.ut_event === 'ready') {
                        pm2.start(params.map((config, i) => {
                            return {
                                name: config.app,
                                script: scripts.worker,
                                args: getArgs(config.app),
                                node_args: getNodeArgs(),
                                env: getEnv(),
                                max_memory_restart: '500M'
                            }
                        }), function(err, apps) {
                            // pm2.disconnect();   // Disconnects from PM2
                            return err ? reject(err) : resolve(apps)
                        });
                    } else if (packet.data.ut_event === 'fail') {
                        pm2.disconnect();
                    }
                });
            });
        })
    }
};
