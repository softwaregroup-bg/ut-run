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
                    load:this.load.bind(this)
                });
            }
        },

        load:function(implementation, port, environment) {
            var config = new nconf.Provider({
              stores: {
                user:{type: 'file', file: path.join(process.cwd(), 'impl', implementation, 'ports', port + '.' + (environment || 'dev') + '.json')},
                global:{type: 'file', file: path.join(process.cwd(), 'impl', implementation, 'ports', port + '.json')}
              }
            }).get();

            this.config[port] = config;

            return this.wire({
                port:{
                    module:'ut-port-' + config.type,
                    init:'init',
                    properties:{
                        config:config,
                        bus:{$ref:'bus'}
                    }
                }
            }, {require:require});
        },

        run:function() {
        }

    };

});}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
