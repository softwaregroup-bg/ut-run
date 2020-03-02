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
                jobs: new RegExp(`^ut${envConfig.implementation}.test`, 'i'),
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
                    domain: true
                }
            }
        }
    }, envConfig);

    const {utRun: {test: {jobs, context}}} = serverConfig;
    const steps = envConfig.steps;

    return require('./test')({
        type: 'unit',
        name: 'unit tests',
        broker: false,
        client: false,
        server,
        serverConfig,
        context,
        jobs: steps ? [{
            name: 'port.test',
            steps: function test(test, bus, run) {
                return typeof steps === 'function' ? steps(test, bus) : run(test, bus, steps);
            }
        }] : jobs
    });
};
