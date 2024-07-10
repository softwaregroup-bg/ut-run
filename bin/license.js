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

    try {
        const {project} = await serviceBus.importMethod('license.project.add')({
            projectName,
            repository
        });

        process.env.AEGIS_BUILD = 1;
        process.env.AEGIS_KEY = project.encryptionKey;
        process.env.AEGIS_IV = project.encryptionIV;
        process.env.AEGIS_CIPHER = project.encryptionCipher;
    } catch (e) {
        serviceBus.log.error(e);
    }

    return serviceBus.stop();
};
