const debug = require('./debug');
const merge = require('ut-function.merge');
const got = require('got');
const fs = require('fs-plus');
module.exports = async function(serviceConfig, envConfig, assert, vfs) {
    const extraConfig = {
        run: {
            logLevel: 'info'
        },
        utPort: {
            logLevel: 'warn'
        },
        utBus: {
            serviceBus: {
                logLevel: 'warn',
                jsonrpc: {
                    utLogin: false,
                    api: true
                }
            }
        }
    };
    const {serviceBus, log, stop} = await debug(serviceConfig, merge(envConfig, extraConfig), assert, vfs);
    try {
        const api = `${serviceBus.rpc.info().uri}/api`;
        const modules = await got(`${api}.json`).json();
        for (const {namespace, openapi, swagger} of modules) {
            if (openapi) {
                const filename = `system/api/${namespace}/openapi.json`;
                log.info && log.info('saving ' + filename);
                const doc = await got(`${api}/${namespace}/openapi.json`).json();
                fs.writeFileSync(filename, JSON.stringify(doc, null, 4));
            }
            if (swagger) {
                const filename = `system/api/${namespace}/swagger.json`;
                log.info && log.info('saving ' + filename);
                const doc = await got(`${api}/${namespace}/swagger.json`).json();
                fs.writeFileSync(filename, JSON.stringify(doc, null, 4));
            }
        }
    } catch (e) {
        log.error && log.error(e);
    }
    return stop();
};
