/* eslint no-process-env:0 */
const create = require('../create');
const merge = require('ut-function.merge');
module.exports = async function license(serviceConfig, envConfig, assert, vfs) {
    const {
        serviceBus,
        mergedConfig: { utLicense: { projectName, repository}}
    } = await create(merge({
        implementation: 'license',
        repl: false,
        utLog: { streams: { udp: false } }
    }, envConfig), vfs);

    const result = {};
    try {
        const {project} = await serviceBus.importMethod('license.project.add')({
            projectName,
            repository
        });
        result.encryptionKey = project.encryptionKey;
        result.encryptionIV = project.encryptionIV;
        result.encryptionCipher = project.encryptionCipher;
    } catch (e) {
        serviceBus.log.error(e);
    }

    await serviceBus.stop();
    return JSON.stringify(result);
};
