const create = require('./create');
const {strOptions} = require('yaml/types');
const yaml = require('yaml');
const path = require('path');
const fs = require('fs');
const sortKeys = require('sort-keys');

module.exports = async function(serviceConfig, envConfig, assert, vfs) {
    const {broker, serviceBus, service, mergedConfig, logFactory} = await create(envConfig, vfs);
    if (service) {
        if (!mergedConfig.run || !mergedConfig.run.layers) {
            throw new Error('Missing run.layers in the configuration');
        }
        if (!mergedConfig.run || !mergedConfig.run.edit) {
            throw new Error('Missing run.edit in the configuration');
        }
        Object.keys(mergedConfig.run.layers).forEach(name => { // enable all layers in run.layers
            const [utModule, layer] = name.split('.', 2);
            if (!mergedConfig[utModule]) mergedConfig[utModule] = {[layer]: true};
            if (!mergedConfig[utModule][layer]) mergedConfig[utModule][layer] = true;
        });
        const ports = await service.create(serviceConfig, mergedConfig, assert);
        const secret = {};
        const resources = service.install({layers: mergedConfig.run.layers, config: mergedConfig, secret, kustomization: true});
        const lineWidth = strOptions.fold.lineWidth; // yet another stupid singleton
        fs.rmSync(path.join('system', 'kustomize'), {recursive: true, force: true}); // force <boolean> When true, exceptions will be ignored if path does not exist
        try {
            strOptions.fold.lineWidth = 1e6;
            [
                ...Object.entries(resources.kustomizations),
                ...Object.entries(resources.namespaces),
                ...Object.entries(resources.secrets),
                ...Object.entries(resources.rbac),
                ...Object.entries(resources.jobs),
                ...Object.entries(resources.deployments),
                ...Object.entries(resources.services),
                ...Object.entries(resources.ingresses)
            ]
                .filter(x => x[0] && x[1])
                .forEach(([name, item]) => {
                    const splitpath = name.split(path.sep);
                    const filename = splitpath.pop();
                    const pathname = path.join('system', 'kustomize', ...splitpath);
                    fs.mkdirSync(pathname, {recursive: true});
                    fs.writeFileSync(path.join(pathname, filename), (typeof item === 'string') ? item : yaml.stringify(sortKeys(item, {deep: true})));
                });
        } finally {
            strOptions.fold.lineWidth = lineWidth;
        }
        for (const port of ports) {
            await port.destroy();
        }
    }
    serviceBus && await serviceBus.destroy();
    broker && await broker.destroy();
    logFactory && await logFactory.destroy();
};
