const debug = require('./debug');
const merge = require('ut-function.merge');
const got = require('got');
const fs = require('fs');
const path = require('path');
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
                    api: {
                        ui: {
                            auth: false
                        }
                    }
                }
            }
        }
    };
    const {serviceBus, logger: log, stop} = await debug(serviceConfig, merge(envConfig, extraConfig), assert, vfs);
    try {
        const api = `${serviceBus.rpc.info().uri}/aa/api`;
        const {api: modules} = await got(`${api}.json`).json();
        for (const {namespace, openapi, swagger} of modules) {
            const pathname = path.join('system', 'api', namespace);
            fs.mkdirSync(pathname, {recursive: true});
            if (openapi) {
                const filename = path.join(pathname, 'openapi.json');
                log.info && log.info('saving ' + filename);
                const doc = await got(`${api}/${namespace}/openapi.json`).json();
                doc.servers = [{url: 'http://localhost'}];
                fs.writeFileSync(filename, JSON.stringify(doc, null, 4));
            }
            if (swagger) {
                const filename = path.join(pathname, 'swagger.json');
                log.info && log.info('saving ' + filename);
                const doc = await got(`${api}/${namespace}/swagger.json`).json();
                doc.host = 'localhost';
                doc.schemes = ['http', 'https'];
                fs.writeFileSync(filename, JSON.stringify(doc, null, 4));
            }
        }
    } catch (e) {
        log.error && log.error(e);
    }
    return stop();
};
