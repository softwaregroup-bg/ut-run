const create = require('./create');

module.exports = async function(serviceConfig, envConfig, assert, vfs) {
    const {broker, serviceBus, service, mergedConfig, logFactory} = await create(envConfig, vfs);
    try {
        const ports = (service && mergedConfig) ? await service.start(await service.create(serviceConfig, mergedConfig, assert)) : [];
        return {
            ports,
            portsMap: ports.reduce((prev, cur) => {
                if (cur && cur.config && (typeof cur.config.id === 'string')) {
                    prev[cur.config.id] = cur;
                }
                return prev;
            }, {}),
            broker,
            serviceBus,
            log: logFactory,
            config: mergedConfig,
            stop: () => {
                let innerPromise = Promise.resolve();
                ports
                    .map((port) => port.destroy.bind(port))
                    .concat(serviceBus ? serviceBus.destroy.bind(serviceBus) : [])
                    .concat(broker ? broker.destroy.bind(broker) : [])
                    .forEach((method) => (innerPromise = innerPromise.then(() => method())));
                return innerPromise;
            }
        };
    } catch (err) {
        serviceBus && serviceBus.destroy();
        broker && broker.destroy();
        throw err;
    }
};
