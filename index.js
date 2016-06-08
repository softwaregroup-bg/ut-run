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

    loadImpl: function(implementation, config) {
        if (typeof implementation === 'string') {
            implementation = require(implementation);
        }

        var ports = implementation.ports;
        config = config || {};
        this.bus.config = config;

        if (implementation.modules instanceof Object) {
            Object.keys(implementation.modules).forEach(function(moduleName) {
                var module = implementation.modules[moduleName];
                (module.init instanceof Function) && (module.init(this.bus));
                this.bus.registerLocal(module, moduleName);
            }.bind(this));
        }

        if (implementation.validations instanceof Object) {
            Object.keys(implementation.validations).forEach(function(validationName) {
                var module = implementation.modules[validationName];
                var validation = implementation.validations[validationName];
                module && Object.keys(validation).forEach(function(value) {
                    merge(module[value], validation[value]);
                });
            });
        }

        return when.all(
            ports.reduce(function(all, port) {
                config[port.id] !== false && all.push(this.loadConfig(merge(port, config[port.id])));
                return all;
            }.bind(this), [])
        ).then(function(contexts) {
            return when.reduce(contexts, function(prev, context) {
                return context.start();
            }, [])
            .then(function() {
                return contexts;
            })
            .catch(function(err) {
                return when.reduce(contexts, function(prev, context) {
                    return new Promise((resolve) => resolve(context.stop())).catch(() => true); // continue on error
                }, [])
                .then(() => Promise.reject(err)); // reject with the original error
            });
        });
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
            if (!process.browser) {
                serverRequire('babel-register')({
                    extensions: ['.jsx'],
                    ignore: false
                });
            }
            var config = params && params.config;
            if (!config) {
                config = {params: {}};
                var argv = require('minimist')(process.argv.slice(2));
                config.params.app = process.env.UT_APP || (params && params.app) || argv._[0] || 'server';
                config.params.method = process.env.UT_METHOD || (params && params.method) || argv._[1] || 'debug';
                config.params.env = process.env.UT_ENV || (params && params.env) || argv._[2] || 'dev';
                config = Object.assign(config, parent.require('./' + config.params.app + '/' + config.params.env));
            }
            var main = (params && params.main) || parent.require('./' + config.params.app);

            config = rc(['ut', config.implementation || 'ut5', process.env.UT_ENV || (params && params.env) || 'dev'].join('-'), config);

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
    run: function(params) {
        this.runParams(params).catch((err) => {
            console.error(err);
            process.abort();
        });
    }

};
