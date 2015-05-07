/**
 * ut-debug module is used to start the switch, like this:
 require('ut-run/debug').start(
 require('../impl/<implementation>/server'),
 require('../impl/<implementation>/config/dev.json')
 );
 */
module.exports = {
    start: function(impl, config) {
        var repl = require('repl').start({prompt: '>'});
        require('when/monitor/console');

        require('wire')({
            consoleHost: config.console.host,
            consolePort: config.console.port,
            serverPort: config.master.serverPort,
            clientPort: config.master.clientPort,
            master: require('ut-run/master')
        }).then(function(context) {
            context.wire({worker: require('ut-run/worker')}).then(function(context) {
                repl.context.app = app = context;
                context.worker.run.loadImpl(impl, config);
            }).done();
        }).done();
    }
}