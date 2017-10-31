/* eslint no-process-env:0, no-console:0, no-process-exit:0 */
var serverRequire = require;// hide some of the requires from lasso
var run = require('./debug');
var rc = require('rc');

module.exports = {
    runParams: function(params, parent, test) {
        params = params || {};
        parent = parent || module.parent;
        if (process.type === 'browser') {
            serverRequire('ut-front/electron')({main: parent.filename});
        } else {
            var config = params.config;
            if (!config) {
                config = {params: {}, runMaster: true, runWorker: true, version: params.version};
                var argv = require('minimist')(process.argv.slice(2));
                var busMode = process.env.UT_BUS_MODE || params.busMode;
                if (busMode === 'master') {
                    config.runWorker = false;
                    params.main = {};
                } else if (busMode === 'worker') {
                    config.runMaster = false;
                }
                config.params.app = process.env.UT_APP || params.app || argv._[0] || 'server';
                config.params.method = process.env.UT_METHOD || params.method || argv._[1] || 'debug';
                config.params.env = process.env.UT_ENV || params.env || argv._[2] || 'dev';
                config.service = config.params.app + '/' + config.params.env;
                Object.assign(config, parent.require('./' + config.params.app + '/' + config.params.env));
            } else {
                config.params = config.params || {};
                config.params.app = params.app;
                config.params.method = params.method;
                config.params.env = params.env;
            }
            var main = params.main || parent.require('./' + config.params.app);

            config = rc(['ut', (config.implementation || 'ut5').replace(/[-/\\]/g, '_'), process.env.UT_ENV || params.env || 'dev'].join('_'), config);

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
            return run[params.method || config.params.method](main, config, test);
        }
    },
    run: function(params, parent, test) {
        return this.runParams(params, parent, test)
        .then((result) => {
            process.send && process.send('ready');
            return result;
        })
        .catch((err) => {
            console.error(err);
            process.exit(1); // this should be removed
        });
    }
};
