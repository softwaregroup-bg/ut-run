const Arborist = require('@npmcli/arborist');
const create = require('../create');
const merge = require('ut-function.merge');
const fs = require('fs');
const path = require('path');
const {parse} = require('csv-parse');

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

            const coverage = {};
            const fileName = 'coverage/lcov.info';
            if (fs.existsSync(fileName)) {
                const parser = fs.createReadStream(fileName).pipe(parse({relax_column_count: true}));
                let type;
                for await (const record of parser) {
                    const [name, value] = record?.[0].split?.(':') || [];
                    if (name === 'SF') type = path.extname(value);
                    const metric = {
                        FNF: 'utRun.cover/functions.found',
                        FNH: 'utRun.cover/functions.hit',
                        LF: 'utRun.cover/lines.found',
                        LH: 'utRun.cover/lines.hit',
                        BRF: 'utRun.cover/branches.found',
                        BRH: 'utRun.cover/branches.hit'
                    }[name];
                    if (type && metric) {
                        const count = Number(value);
                        if (!isNaN(count)) coverage[metric + type] = (coverage[metric + type] ?? 0) + count;
                    }
                }
                await serviceBus.importMethod('tools.measure.add')({
                    build: {
                        branchName,
                        buildNumber,
                        testName: '*',
                        moduleName: tree.packageName,
                        moduleVersion: tree.version
                    },
                    metric: Object.entries(coverage).map(([metricKey, metricValue]) => ({metricKey, metricValue}))
                });
            }

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
