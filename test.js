// require('crypto');
const tap = require('tap');
const log = process.env.WHY_IS_NODE_RUNNING && require('why-is-node-running'); // eslint-disable-line no-process-env
const run = require('./index');
const util = require('util');
const hrtime = require('browser-process-hrtime');
const cucumber = require('./cucumber');
const uuid = require('uuid').v4;
const lowercase = (match, word1, word2, letter) => `${word1}.${word2.toLowerCase()}${letter ? ('.' + letter.toLowerCase()) : ''}`;
const capitalWords = /^([^A-Z]+)([A-Z][^A-Z]+)([A-Z])?/;
const importKeyRegexp = /^([a-z][a-z0-9]*\/)?[a-z][a-zA-Z0-9$]+(\.[a-z0-9][a-zA-Z0-9]+)*(#\[[0+?^]?])?$/;

const proxy = imported => new Proxy({}, {
    get(target, key) {
        if (!importKeyRegexp.test(key)) throw new Error('wrong import proxy key format');
        let method = key.replace(/\$/g, '/');
        if (!method.includes('.')) method = method.replace(capitalWords, lowercase);
        const fn = imported && imported['steps.' + method];
        if (fn instanceof Function) {
            return fn;
        } else {
            throw new Error('Step not found in imports: ' + 'steps.' + method);
        }
    }
});

function sequence(options, test, bus, flow, params, parent) {
    const previous = [];
    const report = cucumber.getReport(options);
    function printSubtest(name, start) {
        if (start) {
            test.comment('-'.repeat(previous.length + 1) + '> subtest start: ' + getName(name));
            previous.push(name);
        } else {
            previous.pop();
            test.comment('<' + '-'.repeat(previous.length + 1) + ' subtest end: ' + getName(name));
        }
    }
    function getName(name) {
        return previous.concat(name).join(' / ');
    }
    function buildSteps(flow) {
        return flow.reduce((steps, step) => {
            step = cucumber.convertStep(step, options);
            if (Array.isArray(step)) {
                return steps.concat(buildSteps(step));
            }
            if (!step.name) {
                throw new Error('step name is required');
            }
            const {method: stepMethod, $meta: stepMeta, params: stepParams, ...rest} = step;
            steps.push({
                methodName: stepMethod,
                method: stepMethod ? bus.importMethod(stepMethod, {returnMeta: true}) : async(params, $meta) => [params, $meta],
                async params() {
                    return (typeof stepParams === 'function') ? stepParams(...arguments) : stepParams;
                },
                ...stepMeta && {
                    async $meta() {
                        return (typeof stepMeta === 'function') ? stepMeta(...arguments) : stepMeta;
                    }
                },
                ...rest
            });
            return steps;
        }, []);
    }

    const buildMeta = ($meta = {}) => $meta.forward ? $meta : {...$meta, forward: {'x-b3-traceid': uuid().replace(/-/g, '')}};

    return (function runSequence(flow, params, parent) {
        const context = parent || {
            ...options.context,
            params: params || {}
        };

        const steps = buildSteps(flow);
        const passed = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'p', 'Passed tests');
        const duration = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'd', 'Test duration');

        let promise = Promise.resolve();
        let passing = true;
        steps.forEach(function(step, index) {
            promise = promise.then(function() {
                const start = Date.now();
                const starthr = hrtime();
                let skip = false;
                function performanceWrite() {
                    bus.performance && bus.performance.write({
                        testName: options.name,
                        stepName: step.name,
                        method: step.methodName,
                        step: index
                    });
                }
                const fn = assert => {
                    return step.params(context, {
                        sequence: function() {
                            printSubtest(step.name, true);
                            return runSequence.apply(null, arguments)
                                .then(function(params) {
                                    printSubtest(step.name);
                                    return params;
                                });
                        },
                        skip: function() {
                            skip = true;
                        }
                    })
                        .then(function(params) {
                            if (skip) {
                                return test.comment('^ ' + getName(step.name) + ' - skipped');
                            }
                            if (Array.isArray(step.steps)) {
                                return sequence(options, assert, bus, step.steps, undefined, context);
                            } else if (typeof step.steps === 'function') {
                                return Promise.resolve()
                                    .then(() => step.steps(context, proxy(options.imported)))
                                    .then(steps => sequence(options, assert, bus, steps, undefined, context));
                            }
                            const promise = step.$meta
                                ? step.$meta(context).then($meta => step.method(params, buildMeta($meta)))
                                : step.method(params, buildMeta(context.$meta));
                            return promise
                                .then(function([result, $meta]) {
                                    duration && duration(Date.now() - start);
                                    passed && passed((result && result._isOk) ? 1 : 0);
                                    performanceWrite();
                                    context[step.name] = result;
                                    if (typeof step.result === 'function') {
                                        step.result.call(context, result, assert, $meta);
                                    } else if (typeof step.error === 'function') {
                                        assert.fail('Result is expected to be an error');
                                    } else {
                                        assert.fail('Test is missing result and error handlers');
                                    }
                                    return result;
                                }, function(error) {
                                    duration && duration(Date.now() - start);
                                    passed && passed(0);
                                    performanceWrite();
                                    if (typeof step.error === 'function') {
                                        if (error && error.type === 'portHTTP') { // temp workaround
                                            error.type = 'PortHTTP';
                                        }
                                        if (error && error.type === 'httpServerPort.notPermitted') { // temp workaround
                                            error.type = 'HttpServer.NotPermitted';
                                        }
                                        step.error.call(context, error, assert);
                                    } else {
                                        throw error;
                                    }
                                });
                        })
                        .then(result => {
                            passing = passing && (Array.isArray(step.steps) || (typeof step.steps === 'function') || assert.passing());
                            report && report.push(cucumber.reportStep(step, starthr, skip ? 'skipped' : passing ? 'passed' : 'failed'));
                            return result;
                        }, error => {
                            passing = false;
                            report && report.push(cucumber.reportStep(step, starthr, 'failed'));
                            throw error;
                        });
                };

                return test.test(getName(step.methodName ? (step.methodName + ' // ' + step.name) : step.name), {skip: !passing && step.context !== false}, fn);
            });
        });
        return promise.catch(test.threw);
    })(flow, params, parent);
}

function performanceTest(params, assert, bus, flow) {
    const loadtest = require('loadtest');
    const step = flow.shift();
    const start = Date.now();
    params.context = params.context || {};

    const passed = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'p', 'Passed tests');
    const duration = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'd', 'Test duration');
    const totalRequests = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalRequests', 'Total requests');
    const totalErrors = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalErrors', 'Total errors');
    const errorMessage = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'ErrorMessage', 'Error message');
    const rps = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'RpS', 'Requests per seconds');
    const meanLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MeanLatencyMS', 'Mean latency');
    const maxLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MaxLatencyMs', 'Max latency');

    const errors = [];
    assert.test(step.name || ('testing method ' + step.methodName), {bufferred: false}, (methodAssert) => {
        let state = true;
        const httpSettings = {
            url: step.url || params.url,
            body: Object.assign({method: step.method, params: (typeof step.params === 'function') ? step.params(params.context) : step.params},
                params.body || {jsonrpc: '2.0', id: 1}),
            method: step.httpMethod || params.httpMethod || 'POST',
            contentType: step.contentType || params.contentType || 'application/json',
            maxRequests: step.maxRequests || params.maxRequests || 10, // max requests per api call for the whole test
            concurrency: step.concurrency || params.concurrency || 1, // threads in parallel
            timeout: step.timeout || params.timeout || 30000,
            cookies: step.cookies || params.cookies || [],
            statusCallback: function(latency, response, error) {
                if (error) {
                    state = false;
                }
                let result;
                if (response) {
                    const cookie = step.storeCookies && response.headers && response.headers['set-cookie'] && (response.headers['set-cookie'][0].split(';'))[0];
                    if (cookie) {
                        params.cookies = cookie;
                    }
                    result = JSON.parse(response.body);
                    if (result.error) {
                        state = false;
                        errors.push(result.error.message);
                        methodAssert.true(state, result.error.message);
                    }
                    params.context[step.name] = result;
                    step.result(result, assert, response);
                }
                state = state && assert._ok && result;
            }
        };
        return new Promise(function(resolve, reject) {
            loadtest.loadTest(httpSettings, function(error, result) {
                error ? reject(error) : resolve(result);
            });
        }).then(function(result) {
            duration && duration(Date.now() - start);
            passed && passed(state ? 1 : 0);
            totalRequests && totalRequests(result.totalRequests);
            totalErrors && totalErrors(result.totalErrors);
            errorMessage && errorMessage(errors);
            rps && rps(result.rps);
            meanLatencyMs && meanLatencyMs(result.meanLatencyMs);
            maxLatencyMs && maxLatencyMs(result.maxLatencyMs);

            const metrics = {stepName: step.name, method: step.method};

            if (result.errorCodes) {
                const keys = Object.keys(result.errorCodes);
                keys.forEach(function(key) {
                    const errorCode = params.name && bus.performance &&
                        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'ErrorCode' + key, 'Error code ' + key);
                    if (typeof errorCode === 'function') errorCode(result.errorCodes[key]);
                });
            }
            bus.performance && bus.performance.write(metrics);
            if (flow.length) {
                performanceTest(params, assert, bus, flow);
            } else {
                setTimeout(() => {
                    bus && bus.performance && bus.performance.stop();
                }, 5000);
            }
            return true;
        });
    });
}

module.exports = function(params, cache) {
    let clientConfig;
    const cucumberReport = {};

    if (cache && cache.uttest) {
        if (!cache.first) {
            cache.first = true;
            if (params.peerImplementations) {
                tap.test('Starting peer implementations...', (assert) => Promise.all(params.peerImplementations));
            }
        } else {
            return {
                tests: tap.test('*** Reusing cache for ' + params.name, (assert) => params.steps(assert, cache.serviceBus, sequence.bind(null, params), cache.ports))
            };
        }
    }
    const services = [];
    const stopServices = (test) => {
        if (!services.length) {
            return Promise.resolve();
        }
        return tap.test('Stopping services...', {bufferred: false}, (assert) => {
            return services.reduce((promise, service) => {
                return promise.then(() => {
                    return service.app.stop()
                        .then(() => {
                            return assert.ok(true, `${service.name} service stopped.`);
                        });
                });
            }, Promise.resolve());
        });
    };

    let tests = tap.test('Starting tests', () => Promise.resolve());
    if (params.cluster) {
        tests = tests.then(() => tap.test('workers', {bufferred: false, bail: true}, assert =>
            Promise.all(Object.values(params.cluster.workers).map(worker => new Promise((resolve, reject) => {
                worker.once('listening', () => {
                    assert.ok(true, `worker ${worker.id} listening`);
                });
                worker.once('error', reject);
                worker.once('disconnect', reject);
                worker.on('message', message => {
                    if (message === 'ready') {
                        worker.removeListener('error', reject);
                        worker.removeListener('disconnect', reject);
                        assert.ok(true, `worker ${worker.id} ready`);
                        resolve(worker.id);
                    }
                });
            })))
        ));
    }

    let brokerRun;
    if (params.brokerConfig) {
        const brokerConfig = {
            main: params.broker || [],
            config: params.brokerConfig,
            env: 'test',
            method: 'debug'
        };
        tests = tests.then(() => tap.test('broker start', {bufferred: false, bail: true}, assert => {
            brokerRun = run.run(brokerConfig, module.parent, assert);
            return brokerRun;
        }));
    }

    if (Array.isArray(params.services)) {
        tests = tests.then(() => tap.test('Starting services...', {bufferred: false, bail: true}, (assert) => {
            return params.services.reduce((promise, service) => {
                return promise.then(() => {
                    return service()
                        .then((app) => {
                            assert.ok(true, `${service.name} service started.`);
                            return services.unshift({
                                app,
                                name: service.name
                            });
                        });
                });
            }, Promise.resolve());
        }));
    }

    if (params.type && params.type === 'performance') {
        clientConfig = {
            main: params.client,
            config: params.clientConfig,
            method: 'debug'
        };
        const clientsRun = run.run(clientConfig);
        tap.test('Performance test start', (assert) => clientsRun.then((client) => {
            params.steps(assert, client.serviceBus, performanceTest.bind(null, params), client.ports);
            return true;
        }));
        return;
    }

    const serverConfig = {
        main: params.server,
        config: [].concat(params.serverConfig, {
            utBus: {
                serviceBus: {
                    test: true
                }
            },
            utPort: {
                test: true
            }
        }),
        app: params.serverApp || '../../server',
        env: params.serverEnv || 'test',
        method: params.serverMethod || 'debug'
    };
    clientConfig = params.client && {
        main: params.client,
        config: [].concat(params.clientConfig, {
            utBus: {
                serviceBus: {
                    test: true
                }
            },
            utPort: {
                test: true
            }
        }),
        app: params.clientApp || '../../desktop',
        env: params.clientEnv || 'test',
        method: params.clientMethod || 'debug'
    };

    let serverRun;
    let serverObj;
    // tap.jobs = 1;
    tests = tests.then(() => tap.test('server start', {bufferred: false, bail: true}, assert => {
        serverRun = run.run(serverConfig, module.parent, assert);
        return serverRun.then((server) => {
            serverObj = server;
            !clientConfig && cache && (cache.serviceBus = server.serviceBus) && (cache.ports = server.ports);
            const result = clientConfig ? server : Promise.all(server.ports.map(port => port.isConnected));
            return result;
        });
    }));

    function startClient(assert) {
        if (!clientConfig) return Promise.resolve(serverObj);
        return serverRun
            .then(server => {
                if (Array.isArray(clientConfig.config)) {
                    clientConfig.config.push({server: () => server});
                } else {
                    clientConfig.config && (clientConfig.config.server = () => server);
                }
                return run.run(clientConfig, module.parent, assert)
                    .then((client) => {
                        cache && (cache.serviceBus = client.serviceBus) && (cache.ports = client.ports);
                        return Promise.all(client.ports.map(port => port.isConnected))
                            .then(() => client);
                    });
            });
    }

    const testClient = testConfig => assert => assert.test('client tests', async assert => {
        const client = await startClient(assert);
        await testConfig.steps(assert, client.serviceBus, sequence.bind(null, testConfig), client.ports, proxy(testConfig.imported));
        await assert.test('client stop', a => stop(a, client));
    }).catch(assert.threw);

    const testServer = testConfig => assert => assert.test('server tests', async assert => {
        await testConfig.steps(assert, serverObj.serviceBus, sequence.bind(null, testConfig), serverObj.ports, proxy(testConfig.imported));
    }).catch(assert.threw);

    const testAny = clientConfig ? testClient : testServer;
    let imported;

    if (params.imports) {
        tests = tests.then(t => {
            const target = {};
            serverObj.serviceBus.attachHandlers(target, [params.imports]);
            imported = target.imported;
            return t;
        });
    }
    tests = tests.then(assert => cucumber.testFeatures(assert, params, serverObj, cucumberReport, imported, testAny));
    if (params.jobs) {
        tests = tests.then(() => tap.test('jobs', {jobs: 100}, test => {
            let jobs = params.jobs;
            if (typeof jobs === 'string' || jobs instanceof RegExp) {
                const target = {};
                serverObj.serviceBus.attachHandlers(target, [jobs]); // test specified test methods from bus
                jobs = [].concat( // convert them to an array of job definitions
                    ...Array.from(target.importedMap.entries())
                        .map(([jobName, importedJob]) => Object.entries(importedJob).map(([name, steps]) => ({
                            feature: cucumber.addFeature(cucumberReport, jobName, params),
                            name: jobName + '.' + name,
                            context: params.context,
                            steps
                        }))));
            }
            if (params.exclude) {
                let exclude;
                switch (params.exclude.constructor.name) {
                    case 'RegExp':
                        exclude = params.exclude;
                        break;
                    case 'Array':
                        exclude = new RegExp(`^(${params.exclude.join('|')})$`);
                        break;
                    case 'String':
                        exclude = new RegExp(`^${params.exclude}$`);
                        break;
                    default:
                        break;
                }
                if (exclude) {
                    jobs = jobs.filter(job => !exclude.test(job.name));
                } else {
                    throw new Error('Invalid \'exclude\' property [', params.exclude, '] Must be one of: RegExp, Array, String');
                }
            }
            Promise
                .resolve()
                .then(() => (serverObj.config.run && serverObj.config.run.test && serverObj.config.run.test.prompt) ? require('./prompt')(jobs) : jobs)
                .then(selectedJobs => {
                    test.plan(selectedJobs.length);
                    selectedJobs.forEach(job => {
                        if (!job) return;
                        test.test(job.name, testAny({imported, ...job}));
                    });
                    return selectedJobs;
                })
                .catch(test.threw);
        }));
    } else {
        tests = tests.then(testAny({...params, imported}));
    }

    tests = tests.then(() => cucumber.writeReport(cucumberReport)(tap));

    function stop(assert, x) {
        let promise = Promise.resolve();
        const steps = [];
        let current;
        const step = (name, fn) => {
            promise = promise
                .then(value => {
                    current = name;
                    return value;
                })
                .then(fn)
                .then(result => {
                    steps.push(name);
                    return result;
                }, error => {
                    assert.comment(steps.join('\r\n'));
                    assert.fail(name);
                    return error;
                });
        };

        if (params.cluster) {
            Object.values(params.cluster.workers).forEach(worker => {
                step(`stop worker ${worker.id}`, () => {
                    return worker.isDead() || new Promise((resolve, reject) => {
                        const force = setTimeout(() => {
                            assert.ok(true, `worker ${worker.id} kill`);
                            worker.process.kill();
                            resolve();
                        }, 10000);
                        worker.on('exit', (code, signal) => {
                            clearTimeout(force);
                            assert.ok(true, `worker ${worker.id} exit ${signal || code}`);
                            resolve();
                        });
                        worker.kill();
                    });
                });
            });
        }
        x.ports.forEach(port => step((port.config ? port.config.id : '?'), () => port.destroy()));
        x.serviceBus && step('bus', () => x.serviceBus.destroy());
        x.broker && step('broker', () => x.broker.destroy());
        x.log && x.log.destroy && step('main loger', () => x.log.destroy());
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out on ' + current + '.destroy'));
            }, 10000 * (1 + (params.cluster ? Object.keys(params.cluster.workers).length : 0)));
            promise
                .then(value => {
                    clearTimeout(timeout);
                    assert.ok(true, 'destroy[' + steps.join(',') + ']');
                    resolve(value);
                    return value;
                })
                .catch(reject);
        });
    }

    const stopAll = function(test) {
        stopServices(test);
        params.peerImplementations && test.test('Stopping peer implementations', {bufferred: false}, (assert) => {
            let x = Promise.resolve();
            params.peerImplementations.forEach((promise) => {
                x = x.then(() => (promise.then((impl) => (impl.stop()))));
            });
            return x;
        });
        return Promise.resolve()
            .then(() => test.test('server stop', {bufferred: false}, assert => serverRun
                .then(result => stop(assert, result)))
                // .then(() => setTimeout(log, 2000))
                .catch(() => Promise.reject(new Error('Server did not start'))))
            .then(() => brokerRun && test.test('broker stop', {bufferred: false}, assert => brokerRun
                .then(result => stop(assert, result)))
                .catch(() => Promise.reject(new Error('Broker did not start'))));
    };

    const running = function() {
        const last = params.serverConfig && params.serverConfig.run && params.serverConfig.run.last;
        if (last !== false) {
            tap.setTimeout(10000);
            tap.on('timeout', () => {
                if (log) {
                    log({
                        error: function() {
                            tap.comment(util.format(...arguments));
                        }
                    });
                } else {
                    tap.comment('Looks like there are active handles, which prevent node from stopping. Rerun tests with WHY_IS_NODE_RUNNING=1 in the environment to list the handles.');
                }
                process.exit(1); // eslint-disable-line no-process-exit
            });
        }
    };

    return tests
        .then(stopAll)
        .then(running)
        .catch(e => {
            running();
            throw e;
        });
};
