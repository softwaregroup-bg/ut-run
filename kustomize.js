const create = require('./create');
var serverRequire = require;

module.exports = async function(serviceConfig, envConfig, assert) {
    const {broker, serviceBus, service, mergedConfig} = await create(envConfig);
    if (service) {
        if (!mergedConfig.run && !mergedConfig.run.layers) {
            throw new Error('Missing run.layers in the configuration');
        }
        Object.keys(mergedConfig.run.layers).forEach(name => { // enable all layers in run.layers
            const [utModule, layer] = name.split('.', 2);
            if (!mergedConfig[utModule]) mergedConfig[utModule] = {[layer]: true};
            if (!mergedConfig[utModule][layer]) mergedConfig[utModule][layer] = true;
        });
        const ports = await service.create(serviceConfig, mergedConfig, assert);
        const editor = serverRequire('./configEditor');
        await editor(envConfig, mergedConfig.run.schema, service);
        for (const port of ports) {
            await port.destroy();
        }
    }
    serviceBus && await serviceBus.destroy();
    broker && await broker.destroy();
};
