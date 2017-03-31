/* eslint no-process-env:0, no-console:0 */

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
        params = params || {};
        parent = parent || module.parent;
        if (process.type === 'browser') {
            serverRequire('ut-front/electron')({main: parent.filename});
        } else {
            var config = params.config;
            if (!config) {
                config = {params: {}, runMaster: true, runWorker: true};
                var argv = require('minimist')(process.argv.slice(2));
                var busMode = process.env.UT_BUS_MODE || params.busMode;
                if (busMode === 'master') {
                    condig.runWorker = false;
                    params.main = {};
                } else if (busMode === 'worker') {
                    config.runMaster = false;
                }
                config.params.app = process.env.UT_APP || params.app || argv._[0] || 'server';
                config.params.method = process.env.UT_METHOD || params.method || argv._[1] || 'debug';
                config.params.env = process.env.UT_ENV || params.env || argv._[2] || 'dev';
                config = Object.assign(config, parent.require('./' + config.params.app + '/' + config.params.env));
            }
            var main = params.main || parent.require('./' + config.params.app);

            config = rc(['ut', (config.implementation || 'ut5').replace(/-/g, '_'), process.env.UT_ENV || params.env || 'dev'].join('_'), config);

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
            return run[params.method || config.params.method](main, config);
        }
    },
    run: function(params, parent) {
        return this.runParams(params, parent)
        .then((result) => {
            process.send && process.send('ready');
            return result;
        })
        .catch((err) => {
            console.error(err);
            process.abort();
        });
    }
};
