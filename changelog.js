const Arborist = require('@npmcli/arborist');
const create = require('./create');
const merge = require('ut-function.merge');
const {readFile, appendFileSync} = require('fs');
const path = require('path');
module.exports = async function doc(serviceConfig, envConfig, assert, vfs) {
    const arb = new Arborist({path: process.cwd()});
    const [tree, {serviceBus, mergedConfig: {utChangelog, utJenkins}}] = await Promise.all([
        arb.loadActual(),
        create(merge({
            implementation: 'changelog',
            repl: false,
            utLog: { streams: { udp: false } }
        }, envConfig), vfs)
    ]);
    const {record} = await serviceBus.importMethod('tools.record.get')({
        moduleName: tree.name,
        moduleVersion: utChangelog?.fromVersion,
        recordKey: 'utDependencies'
    });

    const recordValue = {};
    const updatedModules = [];

    for (const [moduleName, {version}] of tree.children.entries()) {
        if (moduleName.startsWith('ut-')) {
            recordValue[moduleName] = version;
            const fromVersion = record?.recordValue[moduleName];
            if (fromVersion && fromVersion !== version) {
                updatedModules.push({moduleName, fromVersion, toVersion: version});
            }
        }
    }

    const excerpts = await Promise.all(
        updatedModules
            .map(({moduleName, fromVersion, toVersion}) => new Promise((resolve, reject) => {
                let moduleChangelogLocation;
                try {
                    moduleChangelogLocation = require.resolve(path.join(moduleName, 'CHANGELOG.md'), {paths: [tree.path]});
                } catch (e) {
                    return reject(e);
                }
                readFile(moduleChangelogLocation, (err, data) => {
                    if (err) return reject(err);
                    const match = new RegExp(`#+\\s\\[${toVersion.replace(/\./g, '\\.')}\\][\\s\\S]+(\\r?\\n|\\r)#+\\s\\[${fromVersion.replace(/\./g, '\\.')}\\].*(\\r?\\n|\\r)`, 'gm');
                    const content = data.toString().replace(/#+/g, x => x + '##').match(match);
                    resolve(`## ${moduleName} (${fromVersion} -> ${toVersion})\n\n${content}`);
                });
            }))
    );

    await appendFileSync(path.join(tree.path, 'UT-CHANGELOG.md'), `# ${tree.version}\n\n${excerpts.join('\n\n')}`);

    await serviceBus.importMethod('tools.record.add')({
        record: {
            moduleName: tree.name,
            moduleVersion: tree.version,
            recordKey: 'utDependencies',
            recordValue,
            branchName: utJenkins?.branchName,
            buildNumber: utJenkins?.buildNumber
        }
    });

    return serviceBus.stop();
};
