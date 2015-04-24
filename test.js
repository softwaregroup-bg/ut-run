/**
 * ut-debug module is used to start the switch, like this:
 require('ut-run/debug').start(
 require('../impl/<implementation>/server'),
 require('../impl/<implementation>/config/dev.json')
 );
 */

var when = require('when');

module.exports = {
    start: function(impl, config) {
        require('repl').start({useGlobal: true});
        require('when/monitor/console');

        impl.ports.forEach(function (port) {
            port.logLevel = 'error';
        })
        var worker = require('ut-run/worker');
        worker.bus.properties.logLevel = 'error';
        return when.promise(function(resolve, reject) {
            require('wire')({
                consoleHost: config.console.host,
                consolePort: config.console.port,
                serverPort: config.master.serverPort,
                clientPort: config.master.clientPort,
                master: require('ut-run/master'),
                worker: worker
            }).then(function(app) {
                app.worker.run.loadImpl(impl, config);
                resolve(app);
            })
        })
    }
}