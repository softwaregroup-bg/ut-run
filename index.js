/* eslint no-console:0, no-process-exit:0 */
const serverRequire = require;
const methods = require('./methods');
const {load} = require('ut-config');

module.exports = {
    getConfig: load,
    runParams: async function(params = {}, test, config) {
        if (!config) config = await load(params);
        const method = config.params.method;
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
        return methods[method](main, config, test);
    },
    run: async function(params, test) {
        if (process.type === 'browser') {
            return serverRequire('ut-front/electron')({main: params.root});
        }
        let config = {service: 'undefined'};
        try {
            config = await load(params);
            const result = await this.runParams(params, test, config);
            process.send && process.send('ready');
            return result;
        } catch (err) {
            console.error(JSON.stringify({
                error: {...err, stack: err.stack.split('\n')},
                level: 50,
                service: config.service,
                pid: process.pid,
                hostname: require('os').hostname(),
                name: 'run',
                context: 'run',
                mtd: 'error',
                $meta: {
                    method: 'utRun.run',
                    mtid: 'error'
                },
                msg: err.message,
                time: (new Date()).toISOString(),
                v: 0
            }));
            process.exit(1); // this should be removed
        }
    }
};
