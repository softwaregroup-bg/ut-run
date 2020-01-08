module.exports = function unit(serviceConfig, envConfig, assert) {
    const server = [() => {
        switch (typeof serviceConfig) {
            case 'function':
                return {test: [serviceConfig]};
            case 'object':
                return Array.isArray(serviceConfig) ? {test: serviceConfig} : serviceConfig;
            default:
                return {};
        }
    }];

    const { steps } = envConfig;
    delete envConfig.steps;
    delete envConfig.params;

    const serverConfig = {
        implementation: 'test',
        repl: false,
        utBus: {
            serviceBus: {
                jsonrpc: {
                    socket: true
                }
            }
        },
        utLog: {
            streams: {
                udp: false
            }
        },
        ...envConfig
    };

    if (typeof steps === 'undefined') return require('./debug')(server, serverConfig, assert);

    return require('./test')({
        type: 'unit',
        name: 'unit tests',
        broker: false,
        client: false,
        server,
        serverConfig,
        jobs: [{
            name: 'port.test',
            steps: function test(test, bus, run) {
                return typeof steps === 'function' ? steps(test, bus) : run(test, bus, steps);
            }
        }]
    });
};
