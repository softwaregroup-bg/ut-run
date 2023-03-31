const Arborist = require('@npmcli/arborist');
const create = require('./create');
const merge = require('ut-function.merge');
const fs = require('fs');
const path = require('path');
const semverCoerce = require('semver/functions/coerce');
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

    let record;
    try {
        const recordResult = await serviceBus.importMethod('tools.record.get')({
            moduleName: tree.packageName,
            moduleVersion: utChangelog?.fromVersion,
            recordKey: 'utDependencies'
        });
        record = recordResult.record;
    } catch (e) {
        serviceBus.log.error(e);
        return serviceBus.stop();
    }

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
                const fromVersionCoerced = semverCoerce(fromVersion)?.version;
                if (!fromVersionCoerced) return reject(new Error(`Previous version for '${moduleName}' could not be detected`));
                let moduleChangelogLocation;
                try {
                    moduleChangelogLocation = require.resolve(path.join(moduleName, 'CHANGELOG.md'), {paths: [tree.path]});
                } catch (e) {
                    return resolve('');
                }
                fs.open(moduleChangelogLocation, (err, fd) => {
                    if (err) return reject(err);
                    fs.read(fd, {buffer: Buffer.alloc(345678)}, (err, bytesRead, buffer) => {
                        if (err) return reject(err);
                        fs.close(fd, err => {
                            if (err) return reject(err);
                            const match = new RegExp(`#+\\s\\[${toVersion.replace(/\./g, '\\.')}\\][\\s\\S]+(\\r?\\n|\\r)#+\\s\\[${fromVersionCoerced.replace(/\./g, '\\.')}\\].*(\\r?\\n|\\r)`, 'gm');
                            const content = buffer.toString().replace(/^#+/gm, x => x + '##').match(match);
                            resolve(`## ${moduleName} (${fromVersion} -> ${toVersion})\n\n${content}`);
                        });
                    });
                });
            }))
    );

    const file = path.join(tree.path, 'UT-CHANGELOG.md');
    const data = `# ${tree.version}\n\n${excerpts.join('\n\n')}`;
    try {
        fs.writeFileSync(file, Buffer.concat(Buffer.from(data), fs.readFileSync(file)));
    } catch (e) {
        if (e.code === 'ENOENT') fs.writeFileSync(file, data);
        else throw e;
    }

    await serviceBus.importMethod('tools.record.add')({
        record: {
            moduleName: tree.packageName,
            moduleVersion: tree.version,
            recordKey: 'utDependencies',
            recordValue,
            branchName: utJenkins?.branchName,
            buildNumber: utJenkins?.buildNumber
        }
    });

    return serviceBus.stop();
};
