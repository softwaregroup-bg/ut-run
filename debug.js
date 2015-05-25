/**
 * ut-debug module is used to start the switch, like this:
 require('ut-run/debug').start(
 require('../impl/<implementation>/server'),
 require('../impl/<implementation>/config/dev.json')
 );
 */
var _ = require('lodash');
module.exports = {
    start: function(impl, config) {
        var repl = require('repl').start({prompt: '>'});
        var defaultConfig = {
            masterBus: {
                logLevel:"debug"
            },
            workerBus: {
                logLevel:"debug"
            },
            console: {
                host: "0.0.0.0",
                port: 30001
            }
        }
        require('when/monitor/console');

        require('wire')(_.assign({config: _.assign(defaultConfig, config)},
            require('ut-run/logger'),
            require('ut-run/master'),
            require('ut-run/worker')
        )).then(function(context) {
            repl.context.app = app = context;
            context.run.loadImpl(impl, config);
        }).done();
    }
}
