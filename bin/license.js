const create = require('../create');
const merge = require('ut-function.merge');
module.exports = async function license(serviceConfig, envConfig, assert, vfs) {
    const {
        serviceBus,
        mergedConfig: { utLicense: { projectName, repository}}
    } = await create(merge({
        implementation: 'license',
        repl: false,
        log: false
    }, envConfig), vfs);

    try {
        const {project} = await serviceBus.importMethod('license.project.add')({ projectName, repository});
        process.stdout.write(JSON.stringify({
            encryptionKey: project.encryptionKey,
            encryptionIV: project.encryptionIV,
            encryptionCipher: project.encryptionCipher
        }));
    } catch (e) {
        process.stderr.write(e);
    }

    return serviceBus.stop();
};
