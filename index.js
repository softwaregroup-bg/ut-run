(function(define) {define(function(require) {

    var nconf = require('nconf');
    var path = require('path');

    return {

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
});}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
