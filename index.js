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

function getConfig(params = {}) {
    let config = params.config;
    if (Array.isArray(config)) config = merge({}, ...config);
    if (!config) {
        config = {params: {}, version: params.version};
        var argv = require('minimist')(process.argv.slice(2));
        config.params.app = process.env.UT_APP || params.app || argv._[0] || 'server';
        config.params.method = process.env.UT_METHOD || params.method || argv._[1] || 'debug';
        config.params.env = process.env.UT_ENV || params.env || argv._[2] || 'dev';
        config.service = config.params.app + '/' + config.params.env;
        const appPath = path.dirname(params.resolve('./' + config.params.app));
        mount(params.root, config.params.app);
        // load and merge configurations
        const configFilenames = ['common', config.params.env];
        const configs = configFilenames
            .map(filename => {
                let configPath;
                try {
                    configPath = require.resolve(path.join(appPath, filename));
                } catch (e) {}
                return configPath && require(configPath);
            })
            .filter(x => x);
        if (!configs.length) {
            throw new Error(`${configFilenames.join(' and/or ')} configuration must be provided`);
        }
        merge(config, ...configs, params.params);
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

function extractConfig(target, path, source) {
    const result = target;
    path.split('.').forEach((token, i, tokens) => {
        if (i !== tokens.length - 1) {
            if (!target[token]) target[token] = {};
            target = target[token];
            source = source[token];
        } else {
            target[token] = source[token];
        }
    });
    return result;
};

module.exports = {
    getConfig,
    extractConfig: function(params, paths = []) {
        const config = getConfig(params);
        return paths.reduce((target, path) => extractConfig(target, path, config), {});
    },
    runParams: function(params = {}, test) {
        if (process.type === 'browser') {
            return serverRequire('ut-front/electron')({main: params.root});
        }
        const config = getConfig(params);
        if (config.cluster && config.broker && config.broker.socket) {
            var cluster = serverRequire('cluster');
            if (cluster.isMaster) {
                var workerCount = config.cluster.workers || require('os').cpus().length;
                for (var i = 0; i < workerCount; i += 1) {
                    cluster.fork();
                }
                return Promise.resolve();
            } else {
                if (config.runBroker) { // ensure that multiple brokers don't try to use the same socket / pipe.
                    if (typeof config.broker.socket === 'string') {
                        config.broker.socketPid = true;
                    } else if (typeof config.broker.socket === 'number') {
                        config.broker.socket += cluster.worker.id;
                    } else if (config.broker.socket.port) {
                        config.broker.socket.port += cluster.worker.id;
                    } else {
                        var printableConfigValue = serverRequire('util').inspect(config.broker.socket);
                        throw new Error(`Unsupported broker.socket configuration: ${printableConfigValue}`);
                    }
                }
                config.console && config.console.port && (config.console.port = config.console.port + cluster.worker.id);
            }
        }
        const main = params.main || require(params.resolve('./' + config.params.app));
        return run[params.method || config.params.method](main, config, test);
    },
    run: function(params, test) {
        return this.runParams(params, test)
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
