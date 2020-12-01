/* eslint no-console:0, no-process-exit:0 */
const methods = require('./methods');
const {load} = require('ut-config');
const vfs = require('./vfs');

module.exports = {
    getConfig: load,
    runParams: async function(params = {}, test, config) {
        if (!config) config = await load(params);
        const method = config.params.method;
        let cluster;
        if (config.cluster) {
            cluster = require('./serverRequire')('cluster');
            if (cluster.isMaster) {
                const workerCount = config.cluster.workers || require('os').cpus().length;
                for (let i = 0; i < workerCount; i += 1) {
                    cluster.setupMaster({args: [...process.argv.slice(2), `--service=${config.service}(${i})`]});
                    cluster.fork();
                }
                if (!['unit', 'load'].includes(method)) return Promise.resolve();
            } else {
                if (config.runBroker) { // ensure that multiple brokers don't try to use the same socket / pipe.
                    if (typeof config.broker.socket === 'string') {
                        config.broker.socketPid = true;
                    } else if (typeof config.broker.socket === 'number') {
                        config.broker.socket += cluster.worker.id;
                    } else if (config.broker.socket.port) {
                        config.broker.socket.port += cluster.worker.id;
                    } else {
                        const printableConfigValue = require('./serverRequire')('util').inspect(config.broker.socket);
                        throw new Error(`Unsupported broker.socket configuration: ${printableConfigValue}`);
                    }
                }
                config.console && config.console.port && (config.console.port = config.console.port + cluster.worker.id);
            }
        }
        const main = params.main || require('./serverRequire')(params.resolve('./' + config.params.app));
        return methods[method](main, config, test, vfs, cluster);
    },
    run: async function(params, test, assert) {
        if (process.type === 'browser') {
            return require('./serverRequire')('ut-front/electron')({main: params.root});
        }
        let config = {service: 'undefined'};
        try {
            config = await load(params);
            const result = await this.runParams(params, test, config);
            process.send && process.send('ready');
            if (
                (config.run && config.run.stop) ||
                (!process.browser && require('./serverRequire').utCompile && require('./serverRequire').utCompile.compiling)
            ) {
                await result.stop();
            } else if (!test) {
                if (process.getMaxListeners() < 15) process.setMaxListeners(15);
                process.once('SIGTERM', () => result.stop());
                process.once('SIGINT', () => result.stop());
            }
            return result;
        } catch (err) {
            if (assert) {
                assert.threw(err);
            } else if (err && err.message !== 'silent') {
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
            }
            process.exit(1); // this should be removed
        }
    }
};
