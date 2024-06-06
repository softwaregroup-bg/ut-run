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

        process.env.AEGIS_BUILD = JSON.stringify(project.publicKey);
    } catch (e) {
        serviceBus.log.error(e);
    }

    return serviceBus.stop();
};
