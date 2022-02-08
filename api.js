const debug = require('./debug');
const merge = require('ut-function.merge');
const got = require('got');
const fs = require('fs-plus');
module.exports = async function(serviceConfig, envConfig, assert, vfs) {
    const extraConfig = Object.keys(envConfig.run?.layers || []).reduce((config, name) => {
        const [utModule, layer] = name.split('.');
        if (layer === 'gateway') merge(config, {[utModule]: {[layer]: true}});
        return config;
    }, {
        utBus: {
            serviceBus: {
                jsonrpc: {
                    api: true
                }
            }
        },
        gateway: true,
        utLogin: {
            adapter: true
        }
    });
    const {serviceBus, log, stop} = await debug(serviceConfig, merge(envConfig, extraConfig), assert, vfs);
    try {
        const api = `${serviceBus.rpc.info().uri}/api`;
        const modules = await got(`${api}.json`).json();
        fs.removeSync('system/api');
        for (const {namespace, openapi, swagger} of modules) {
            if (openapi) {
                const doc = await got(`${api}/${namespace}/openapi.json`).json();
                fs.writeFileSync(`system/api/${namespace}/openapi.json`, JSON.stringify(doc, null, 4));
            }
            if (swagger) {
                const doc = await got(`${api}/${namespace}/swagger.json`).json();
                fs.writeFileSync(`system/api/${namespace}/swagger.json`, JSON.stringify(doc, null, 4));
            }
        }
    } catch (e) {
        log.error && log.error(e);
    }
    return stop();
};
