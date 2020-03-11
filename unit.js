const merge = require('ut-function.merge');
module.exports = function unit(serviceConfig, {params, ...envConfig}, assert, vfs) {
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
        utPort: {
            logLevel: 'warn'
        },
        utRun: {
            test: {
                jobs: envConfig.implementation && new RegExp(`^ut${envConfig.implementation}.test`, 'i'),
                features: envConfig.implementation && new RegExp(`^ut${envConfig.implementation}.features`, 'i'),
                imports: envConfig.implementation && /\.steps$/,
                context: {
                    loginMeta: true
                }
            }
        },
        utBus: {
            serviceBus: {
                logLevel: 'warn',
                canSkipSocket: false,
                jsonrpc: {
                    socket: true,
                    domain: 'utrun-unit-' + process.pid
                }
            }
        }
    }, envConfig);

    const {utRun: {test: {jobs, context, imports, features}}} = serverConfig;
    const steps = envConfig.steps;

    if (!jobs && !steps) {
        return require('./debug')(server, serverConfig, assert, vfs);
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
        jobs: steps ? [{
            name: 'port.test',
            steps: function test(test, bus, run) {
                return typeof steps === 'function' ? steps(test, bus) : run(test, bus, steps);
            }
        }] : jobs
    });
};
