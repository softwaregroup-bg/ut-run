/* eslint no-process-env:0, no-console:0, no-process-exit:0 */
var serverRequire = require;// hide some of the requires from lasso
var run = require('./debug');
var rc = require('rc');
var merge = require('ut-port/merge');
var path = require('path');

function mount(parent, m) {
    if (m && process.pkg) {
        var fs = require('fs');
        var path = require('path');
        if (fs.existsSync(path.resolve(m))) {
            console.log(path.resolve(path.dirname(parent.filename), m), path.resolve(m));
            process.pkg.mount(path.resolve(path.dirname(parent.filename), m), path.resolve(m));
        }
    }
}

function getConfig(params = {}, parent = module.parent) {
    let config = params.config;
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
        var envConfig = {};
        var commonConfig = {};
        var shouldThrow = false;
        const appPath = (params.resolve && path.dirname(params.resolve('./' + config.params.app))) || ('./' + config.params.app);
        mount(parent, config.params.app);
        try {
            try {
                commonConfig = parent.require(appPath + '/common');
            } catch (e) {
                shouldThrow = true;
                if (e.code !== 'MODULE_NOT_FOUND') {
                    throw e;
                }
            }
            envConfig = parent.require(appPath + '/' + config.params.env);
        } catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND') {
                throw e;
            } else if (shouldThrow) {
                throw new Error(`'common' and/or '${config.params.env}' configuration must be provided`);
            }
        }
        merge(config, commonConfig, envConfig);
    } else {
        if (!config.params) {
            config.params = {};
        }
        if (!config.params.app) {
            config.params.app = params.app;
        }
        if (!config.params.method) {
            config.params.method = params.method;
        }
        if (!config.params.env) {
            config.params.env = params.env;
        }
    }

    return rc([
        'ut',
        (config.implementation || 'ut5').replace(/[-/\\]/g, '_'),
        process.env.UT_ENV || params.env || 'dev'
    ].join('_'), config);
}

module.exports = {
    getConfig,
    runParams: function(params = {}, parent = module.parent, test) {
        if (process.type === 'browser') {
            return serverRequire('ut-front/electron')({main: parent.filename});
        }
        const config = getConfig(params, parent);
        if (config.cluster && config.masterBus && config.masterBus.socket) {
            var cluster = serverRequire('cluster');
            if (cluster.isMaster) {
                var workerCount = config.cluster.workers || require('os').cpus().length;
                for (var i = 0; i < workerCount; i += 1) {
                    cluster.fork();
                }
                return Promise.resolve();
            } else {
                if (config.runMaster) { // ensure that multiple master bus instances don't try to use the same socket / pipe.
                    if (typeof config.masterBus.socket === 'string') {
                        config.masterBus.socketPid = true;
                    } else if (typeof config.masterBus.socket === 'number') {
                        config.masterBus.socket += cluster.worker.id;
                    } else if (config.masterBus.socket.port) {
                        config.masterBus.socket.port += cluster.worker.id;
                    } else {
                        var printableConfigValue = serverRequire('util').inspect(config.masterBus.socket);
                        throw new Error(`Unsupported masterBus.socket configuration: ${printableConfigValue}`);
                    }
                }
                config.console && config.console.port && (config.console.port = config.console.port + cluster.worker.id);
            }
        }
        const main = params.main || parent.require('./' + config.params.app);
        return run[params.method || config.params.method](main, config, test);
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
