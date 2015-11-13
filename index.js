var when = require('when');
var assign = require('lodash/object/assign');

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
                    assign(module[value], validation[value]);
                });
            });
        }

        return when.all(
            ports.reduce(function(all, port) {
                all.push(this.loadConfig(assign(port, config[port.id])));
                return all;
            }.bind(this), [])
        ).then(function(contexts) {
            return when.reduce(contexts, function(prev, context) {
                return context.port.start();
            }, []).then(function() {
                return ports;
            });
        });
    },

    loadConfig: function(config) {
        var Port = (config.createPort instanceof Function) ? config.createPort : require('ut-port-' + config.type);
        var port = new Port();
        port.bus = this.bus;
        port.logFactory = this.logFactory;
        assign(port.config, config);
        return when(port.init()).then(function() {
            return {port: port};
        });
    },

    run: function() {
        if (process.type === 'browser') {
            require('ut-front/electron')(module.parent.filename);
        } else {
            require('babel-core/register')({
                extensions: ['.jsx']
            });

            var argv = require('minimist')(process.argv.slice(2));
            var app = process.env.UT_APP || argv._[0] || 'server';
            var method = process.env.UT_METHOD || argv._[1] || 'debug';
            var env = process.env.UT_ENV || argv._[2] || 'dev';
            var config = module.parent.require('./' + app + '/' + env + '.json');
            var main = module.parent.require('./' + app);

            if (config.cluster && config.masterBus && config.masterBus.socket && config.masterBus.socket.port) {
                var cluster = require('cluster');
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
            return require('ut-run/' + method).start(main, config);
        }
    }

};
