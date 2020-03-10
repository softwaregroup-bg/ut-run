const fs = require('fs');
const escapeRegEx = require('escape-string-regexp');
const hrtime = require('browser-process-hrtime');
const StackUtils = require('stack-utils');
const utils = new StackUtils();
const traceStep = step => ({...step, callSite: utils.at(traceStep)});

const matcher = name => {
    const vars = /<(\w+)>/g;
    if (!vars.test(name)) return;
    const regex = new RegExp('^' + escapeRegEx(name).replace(vars, (_, name) => `(?<${name}>.*)`) + '$');
    return text => {
        const match = text.match(regex);
        return {...match && match.groups};
    };
};

function writeReport(report) {
    return assert => {
        Object.values(report).forEach(feature => {
            if (!feature.uri) {
                const lines = [];
                const setLine = tag => { tag.line = lines.length; };
                if (feature.tags) {
                    lines.push(feature.tags.map(tag => tag.name).join(' '));
                    feature.tags.forEach(setLine);
                }
                lines.push('Feature: ' + feature.name);
                feature.line = lines.length;
                feature.elements.forEach(scenario => {
                    lines.push('');
                    const ownTags = scenario.tags.filter(tag => !tag.line);
                    if (ownTags) {
                        lines.push('  ' + ownTags.map(tag => tag.name).join(' '));
                        ownTags.forEach(setLine);
                    }
                    lines.push('  Scenario: ' + scenario.name);
                    scenario.line = lines.length;
                    scenario.steps.forEach(step => {
                        lines.push('    * ' + step.name);
                        step.line = lines.length;
                    });
                });
                feature.uri = '.lint/' + feature.id + '.feature';
                fs.writeFileSync(feature.uri, lines.join('\n'));
            }
        });
        const reportName = assert.fullname.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
        if (Object.values(report).length) fs.writeFileSync(`.lint/${reportName}.cucumber.json`, JSON.stringify(Object.values(report)));
        return assert;
    };
}

function testFeatures(assert, params, serverObj, report, imported, testAny) {
    if (!params.features) return assert;
    return assert.test('features', { jobs: 100 }, test => {
        const target = {};
        serverObj.serviceBus.attachHandlers(target, [params.features]);
        const sources = Object.values(target.imported).map(feature => ({ source: feature() }));
        const stepsMap = {};
        const scenariosMap = {};
        const jobs = [];
        const convertTag = tag => ({ name: tag.name, line: tag.location.line });
        if (!sources.length) {
            test.end();
            return;
        }
        const gherkin = require('@cucumber/gherkin');
        gherkin.default.fromSources(sources, { includeSource: false }).on('data', data => {
            if (data.gherkinDocument) {
                Object.assign(stepsMap, [].concat(...data.gherkinDocument.feature.children
                    .map(child => (child.background && child.background.steps) ||
                        (child.scenario && child.scenario.steps))).reduce((prev, step) => ({
                    ...prev,
                    [step.id]: {
                        name: step.text.toLowerCase(),
                        match: matcher(step.text),
                        keyword: step.keyword,
                        line: step.location.line,
                        cucumber: true
                    }
                }), {}));
                Object.assign(scenariosMap, [].concat(...data.gherkinDocument.feature.children
                    .filter(child => child.scenario)
                    .map(child => child.scenario)).reduce((prev, scenario) => ({
                    ...prev,
                    [scenario.id]: (pickleId) => {
                        const feature = {
                            keyword: data.gherkinDocument.feature.keyword,
                            name: data.gherkinDocument.feature.name,
                            id: data.gherkinDocument.feature.name.replace(/ /g, '-').toLowerCase(),
                            line: data.gherkinDocument.feature.location.line,
                            uri: data.gherkinDocument.uri,
                            tags: data.gherkinDocument.feature.tags && data.gherkinDocument.feature.tags.map(convertTag),
                            elements: []
                        };
                        report[pickleId] = feature;
                        const element = {
                            id: feature.id + ';' + scenario.name.replace(/ /g, '-').toLowerCase(),
                            keyword: scenario.keyword,
                            name: scenario.name,
                            tags: (feature.tags || scenario.tags) && (feature.tags || []).concat((scenario.tags || []).map(convertTag)),
                            type: 'scenario',
                            line: scenario.location.line,
                            steps: []
                        };
                        feature.elements.push(element);
                        return element.steps;
                    }
                }), {}));
            }
            if (data.pickle) {
                jobs.push({
                    report: scenariosMap[data.pickle.astNodeIds[0]](data.pickle.id),
                    name: data.pickle.name,
                    context: params.context,
                    imported,
                    steps: (test, bus, run) => run(test, bus, [data.pickle.steps.map(step => ({
                        ...stepsMap[step.astNodeIds[0]],
                        description: step.text
                    }))])
                });
            }
        }).on('error', error => {
            test.threw(error);
        }).on('end', () => {
            if (test.passing()) {
                test.plan(jobs.length);
                jobs.forEach(job => {
                    test.test(job.name, testAny(job));
                });
            }
        });
    });
};

const reportStep = (step, starthr, status) => {
    const endhr = hrtime(starthr);
    return {
        arguments: step.arguments || [],
        keyword: step.keyword || '* ',
        name: step.description || step.name,
        line: step.line,
        match: {
            location: step.callSite && (step.callSite.file + ':' + step.callSite.line)
        },
        result: {
            status,
            duration: 1e9 * endhr[0] + endhr[1]
        }
    };
};

const addFeature = (report, featureName, params) => {
    let result = report[featureName];
    if (!result) {
        result = {
            keyword: 'Feature',
            name: featureName,
            id: featureName.replace(/ /g, '-').toLowerCase(),
            tags: [{
                name: '@ut',
                line: 1
            }, params.broker && {
                name: '@broker',
                line: 1
            }, params.client && {
                name: '@client',
                line: 1
            }, params.serverConfig && params.serverConfig.implementation && {
                name: '@' + params.serverConfig.implementation,
                line: 1
            }, params.type && {
                name: '@' + params.type,
                line: 1
            }].filter(Boolean),
            elements: []
        };
        report[featureName] = result;
    }
    return result;
};

function getReport(options) {
    const feature = options.feature;
    const scenario = feature && {
        id: feature.id + ';' + (options.name || '').replace(/ /g, '-').toLowerCase(),
        keyword: 'Scenario',
        name: options.name || (feature.elements.count + 1),
        tags: feature.tags.concat([options.name && {
            name: '@' + options.name.split('.')[0]
        }].filter(Boolean)),
        type: 'scenario',
        steps: []
    };
    if (feature) feature.elements.push(scenario);
    return options.report || (scenario && scenario.steps);
}

function convertStep(step, options) {
    if (typeof step === 'string') {
        step = {
            name: step.toLowerCase(),
            description: step,
            cucumber: true
        };
    }
    if (step.cucumber === true) {
        step.arguments = step.match ? [step.match(step.description || '')] : [];
        const fn = options.imported && options.imported['steps.' + step.name];
        if (fn instanceof Function) {
            Object.assign(step, fn(traceStep, ...step.arguments));
        } else {
            throw new Error('Step not found in imports: ' + step.name);
        }
    }
    return step;
};

module.exports = {
    getReport,
    writeReport,
    reportStep,
    addFeature,
    convertStep,
    testFeatures
};
