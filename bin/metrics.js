const Arborist = require('@npmcli/arborist');
const create = require('../create');
const merge = require('ut-function.merge');
const fs = require('fs');
const path = require('path');

module.exports = async function metrics(params, envConfig, vfs) {
    const arb = new Arborist({path: process.cwd()});
    const [tree, {serviceBus}] = await Promise.all([
        arb.loadActual(),
        create(merge({
            implementation: 'metrics',
            repl: false,
            utLog: { streams: { udp: false } }
        }, envConfig), vfs)
    ]);
    try {
        const branchName = process.env.GIT_BRANCH; // eslint-disable-line no-process-env
        const buildNumber = process.env.BUILD_NUMBER; // eslint-disable-line no-process-env
        const startDate = process.env.BUILD_DATE; // eslint-disable-line no-process-env
        if (branchName && buildNumber && startDate) {
            const duration = startDate ? (Date.now() - new Date(startDate).getTime()) / 1000 : 0;
            await serviceBus.importMethod('tools.measure.add')({
                build: {
                    branchName,
                    buildNumber,
                    testName: 'build',
                    moduleName: tree.packageName,
                    moduleVersion: tree.version
                },
                metric: [
                    {metricKey: 'dependencies', metricValue: tree.children.size},
                    {metricKey: 'duration', metricValue: duration}
                ]
            });

            const files = fs.readdirSync('.lint');
            for (const file of files) {
                if (/^stats-.*\.txt$/.test(file)) {
                    const metric = fs
                        .readFileSync(path.join('.lint', file))
                        .toString()
                        .split(/\r?\n/)
                        .filter(line => line?.trim())
                        .map(line => {
                            const [metricKey, metricValue] = line.split(' ');
                            return {metricKey, metricValue};
                        });
                    await serviceBus.importMethod('tools.measure.add')({
                        build: {
                            branchName,
                            buildNumber,
                            testName: file,
                            moduleName: tree.packageName,
                            moduleVersion: tree.version
                        },
                        metric
                    });
                }
            }
        }
    } catch (e) {
        serviceBus.log.error(e);
    }
    return serviceBus.stop();
};
