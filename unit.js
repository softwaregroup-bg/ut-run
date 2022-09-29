const merge = require('ut-function.merge');
module.exports = function unit(serviceConfig, {params, ...envConfig}, assert, vfs, cluster) {
    const jobNames = envConfig.jobs || (cluster ? 'load' : 'test');
    const featureNames = envConfig.jobs ? `${envConfig.jobs}Features` : 'features';
    const server = () => {
        if (typeof serviceConfig === 'function') {
            return [{test: [serviceConfig]}];
        }
        return [].concat(serviceConfig);
    };
    const serverConfig = merge({
        implementation: 'test',
        repl: false,
        run: {
            logLevel: 'warn'
        },
        db: {
            debug: true
        },
        utPort: {
            test: true,
            logLevel: 'warn'
        },
        utRun: {
            test: {
                jobs: envConfig.implementation && new RegExp(`^ut${envConfig.implementation}.${jobNames}`, 'i'),
                features: envConfig.implementation && new RegExp(`^ut${envConfig.implementation}.${featureNames}`, 'i'),
                imports: envConfig.implementation && /\.steps$/,
                context: {
                    loginMeta: true
                }
            }
        },
        utBus: {
            serviceBus: {
                logLevel: 'warn',
                canSkipSocket: !!cluster,
                jsonrpc: {
                    ...cluster && {
                        protocol: 'http',
                        port: 8090
                    },
                    server: !cluster || !cluster.isMaster,
                    host: 'localhost'
                }
            }
        }
    }, envConfig);

    const {utRun: {test: {jobs, context, imports, features}}} = serverConfig;
    const steps = envConfig.steps;

    if ((!jobs && !steps) || (cluster && !cluster.isMaster)) {
        return require('./debug')(server, serverConfig, assert, vfs);
    }

    if (cluster) {
        serverConfig.configFilenames = serverConfig.configFilenames.map(item => item === 'unit' ? 'load' : item);
        serverConfig.cluster = false;
    }

    return require('./test')({
        type: 'unit',
        name: 'unit tests',
        broker: false,
        client: false,
        server,
        serverConfig,
        context,
        imports,
        features,
        cluster,
        jobs: steps ? [{
            name: 'port.test',
            steps: function test(test, bus, run) {
                return typeof steps === 'function' ? steps(test, bus) : run(test, bus, steps);
            }
        }] : jobs
    });
};
