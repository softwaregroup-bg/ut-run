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
        var mergedConfig = _.assign({
            masterBus: {
                logLevel:'debug',
                socket:'bus'
            },
            workerBus: {
                logLevel:'debug'
            },
            console: {
                host: '0.0.0.0',
                port: 30001
            },
            log: {
                streams: []
            }
        }, config);
        require('when/monitor/console');
        require('wire')(_.assign({config: mergedConfig},
            config.log === false ? {log:null} : require('ut-run/logger')(mergedConfig.log.streams),
            require('ut-run/master'),
            require('ut-run/worker')
        )).then(function(context) {
            repl.context.app = app = context;
            return context.run.loadImpl(impl, config);
        }).done();
    }
}
