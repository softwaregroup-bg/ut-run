var nconf = require('nconf');
var path = require('path');
var when = require('when');
var _ = require('lodash');

module.exports = {

    bus:null,
    config:null,
    wire:null,

    ready:function() {
        this.config = this.config || {};
        if (this.bus) {
            this.bus.register({
                run:this.run.bind(this),
                loadPort:this.loadPort.bind(this)
            });
        }
    },

    loadPort:function(implementation, port, environment) {
        var config = new nconf.Provider({
          stores: {
            user:{type: 'file', file: path.join(process.cwd(), 'impl', implementation, 'ports', port + '.' + (environment || 'dev') + '.json')},
            global:{type: 'literal', store: require(path.join(process.cwd(), 'impl', implementation, 'ports', port + '.js'))}
          }
        }).get();

        this.config[port] = config;
        return this.loadConfig(config);

    },

    loadImpl:function(implementation, config) {
        if (typeof implementation === 'string') {
            implementation = require (implementation);
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
            Object.keys(implementation.validations).forEach(function (validationName) {
                var module = implementation.modules[validationName];
                var validation = implementation.validations[validationName];
                module && Object.keys(validation).forEach(function (value) {
                    _.assign(module[value], validation[value]);
                });
            });
        }

        return when.all(
            ports.reduce(function(all, port) {
                all.push(this.loadConfig(_.assign(port, config[port.id])));
                return all;
            }.bind(this), [])
        ).then(function(contexts) {
                contexts.forEach(function(context) {
                    context.port.start();
                });
                return ports;
            }
        )
    },

    loadConfig:function(config) {
        return this.wire({
            port:{
                create:'ut-port-' + config.type,
                init:'init',
                properties:{
                    config:config,
                    bus:{$ref:'bus'},
                    logFactory:{$ref:'log'}
                }
            }
        }, {require:require});
    },

    run:function() {
    }

};
