/**
 * ut-debug module is used to start the switch, like this:
 require('ut-run/debug').start(
 require('../impl/<implementation>/server'),
 require('../impl/<implementation>/config/dev.json')
 );
 */

var when = require('when');
var _ = require('lodash');
module.exports = {
    start: function(impl, config) {
        require('when/monitor/console');
        var defaultConfig = {
            masterBus: {
                logLevel:"error",
                socket:"bus"
            },
            workerBus: {
                logLevel:"error"
            },
            console: {
                host: "0.0.0.0",
                port: 30001
            }
        }

        impl.ports.forEach(function (port) {
            port.logLevel = 'error';
        })

        return when.promise(function(resolve, reject) {
            require('wire')(_.assign({config: _.assign(defaultConfig, config)},
                require('ut-run/logger'),
                require('ut-run/master'),
                require('ut-run/worker')
            )).then(function (context) {
                return resolve(context.run.loadImpl(impl, config));
            }).catch(function(err){
                console.log("ERROR Loading implementation! " + err);
                reject(err);
            }).done();
        });
    }
}



