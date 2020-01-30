module.exports = function unit(serviceConfig, envConfig, assert, vfs) {
    const server = () => {
        if (typeof serviceConfig === 'function') {
            return [{test: [serviceConfig]}];
        }
        return [].concat(serviceConfig);
    };

    const { jobs, steps } = envConfig;
    delete envConfig.jobs;
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

    if (typeof jobs === 'undefined' && typeof steps === 'undefined') {
        return require('./debug')(server, serverConfig, assert, vfs);
    }

    return require('./test')({
        type: 'unit',
        name: 'unit tests',
        broker: false,
        client: false,
        server,
        serverConfig,
        jobs: jobs || [{
            name: 'port.test',
            steps: function test(test, bus, run) {
                return typeof steps === 'function' ? steps(test, bus) : run(test, bus, steps);
            }
        }]
    });
};
