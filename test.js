// require('crypto');
var tap = require('tap');
var log = require('why-is-node-running');
var run = require('./index');
var util = require('util');

function promisify(fn) {
    return function() {
        return new Promise(resolve => resolve(fn.apply(this, arguments)));
    };
}

function sequence(options, test, bus, flow, params, parent) {
    function printSubtest(name, start) {
        if (start) {
            test.comment('-'.repeat(previous.length + 1) + '> subtest start: ' + getName(name));
            previous.push(name);
        } else {
            previous.pop();
            test.comment('<' + '-'.repeat(previous.length + 1) + ' subtest end: ' + getName(name));
        }
    }
    var previous = [];
    function getName(name) {
        return previous.concat(name).join(' / ');
    }
    function buildSteps(flow) {
        return flow.reduce((steps, step) => {
            if (Array.isArray(step)) {
                return steps.concat(buildSteps(step));
            }
            if (!step.name) {
                throw new Error('step name is required');
            }
            steps.push({
                name: step.name,
                methodName: step.method,
                method: step.method ? bus.importMethod(step.method) : (params) => Promise.resolve(params),
                params: (typeof step.params === 'function') ? promisify(step.params) : () => Promise.resolve(step.params),
                $meta: (typeof step.$meta === 'function') ? promisify(step.$meta) : (step.$meta && (() => Promise.resolve(step.$meta))),
                steps: step.steps,
                context: step.context,
                result: step.result,
                error: step.error
            });
            return steps;
        }, []);
    }

    return (function runSequence(flow, params, parent) {
        var context = parent || {
            params: params || {}
        };

        var steps = buildSteps(flow);
        var passed = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'p', 'Passed tests');
        var duration = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'd', 'Test duration');

        var promise = Promise.resolve();
        var passing = true;
        steps.forEach(function(step, index) {
            promise = promise.then(function() {
                var start = Date.now();
                var skip = false;
                function performanceWrite() {
                    bus.performance && bus.performance.write({
                        testName: options.name,
                        stepName: step.name,
                        method: step.methodName,
                        step: index
                    });
                }
                var fn = assert => {
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
                                    .then(() => step.steps(context))
                                    .then(steps => sequence(options, assert, bus, steps, undefined, context));
                            }
                            let promise = step.$meta
                                ? step.$meta(context).then($meta => step.method(params, $meta))
                                : step.method(params);
                            return promise
                                .then(function(result) {
                                    duration && duration(Date.now() - start);
                                    passed && passed((result && result._isOk) ? 1 : 0);
                                    performanceWrite();
                                    context[step.name] = result;
                                    if (typeof step.result === 'function') {
                                        step.result.call(context, result, assert);
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
                            return result;
                        }, error => {
                            passing = false;
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
    var loadtest = require('loadtest');
    var step = flow.shift();
    var start = Date.now();
    params.context = params.context || {};

    var passed = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'p', 'Passed tests');
    var duration = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'd', 'Test duration');
    var totalRequests = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalRequests', 'Total requests');
    var totalErrors = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalErrors', 'Total errors');
    var errorMessage = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'ErrorMessage', 'Error message');
    var rps = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'RpS', 'Requests per seconds');
    var meanLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MeanLatencyMS', 'Mean latency');
    var maxLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MaxLatencyMs', 'Max latency');

    var errors = [];
    assert.test(step.name || ('testing method ' + step.methodName), {bufferred: false}, (methodAssert) => {
        var state = true;
        var httpSettings = {
            url: step.url || params.url,
            body: Object.assign({method: step.method, params: (typeof step.params === 'function') ? step.params(params.context) : step.params},
                params.body || {jsonrpc: '2.0', 'id': 1}),
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
                if (response) {
                    var cookie = step.storeCookies && response.headers && response.headers['set-cookie'] && (response.headers['set-cookie'][0].split(';'))[0];
                    if (cookie) {
                        params.cookies = cookie;
                    }
                    var result = response ? JSON.parse(response.body) : {};
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

            var metrics = {stepName: step.name, method: step.method};

            if (result.errorCodes) {
                var keys = Object.keys(result.errorCodes);
                keys.map(function(key) {
                    var errorCode = params.name && bus.performance &&
                        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'ErrorCode' + key, 'Error code ' + key);
                    errorCode(result.errorCodes[key]);
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
    var clientConfig;
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
    var services = [];
    var stopServices = (test) => {
        if (!services.length) {
            return Promise.resolve();
        }
        return test.test('Stopping services...', {bufferred: false}, (assert) => {
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

    var tests = tap.test('Starting tests', () => Promise.resolve());
    var brokerRun;
    if (params.brokerConfig) {
        var brokerConfig = {
            main: params.broker || [],
            config: params.brokerConfig,
            env: 'test',
            method: 'debug'
        };
        tests = tests.then(t => t.test('broker start', {bufferred: false, bail: true}, assert => {
            brokerRun = run.run(brokerConfig, module.parent, assert);
            return brokerRun;
        }));
    }

    if (Array.isArray(params.services)) {
        tests = tests.then(t => t.test('Starting services...', {bufferred: false, bail: true}, (assert) => {
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
        var clientsRun = run.run(clientConfig);
        tap.test('Performance test start', (assert) => clientsRun.then((client) => {
            params.steps(assert, client.serviceBus, performanceTest.bind(null, params), client.ports);
            return true;
        }));
        return;
    }

    var serverConfig = {
        main: params.server,
        config: params.serverConfig,
        app: params.serverApp || '../../server',
        env: params.serverEnv || 'test',
        method: params.serverMethod || 'debug'
    };
    clientConfig = params.client && {
        main: params.client,
        config: params.clientConfig,
        app: params.clientApp || '../../desktop',
        env: params.clientEnv || 'test',
        method: params.clientMethod || 'debug'
    };

    var serverRun;
    var serverObj;
    // tap.jobs = 1;
    tests = tests.then(t => t.test('server start', {bufferred: false, bail: true}, assert => {
        serverRun = run.run(serverConfig, module.parent, assert);
        return serverRun.then((server) => {
            serverObj = server;
            !clientConfig && cache && (cache.serviceBus = server.serviceBus) && (cache.ports = server.ports);
            var result = clientConfig ? server : Promise.all(server.ports.map(port => port.isConnected));
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
        let client = await startClient(assert);
        await testConfig.steps(assert, client.serviceBus, sequence.bind(null, testConfig), client.ports);
        await assert.test('client stop', a => stop(a, client));
    }).catch(assert.threw);

    const testServer = testConfig => assert => assert.test('server tests', async assert => {
        await testConfig.steps(assert, serverObj.serviceBus, sequence.bind(null, testConfig), serverObj.ports);
    }).catch(assert.threw);

    const testAny = clientConfig ? testClient : testServer;

    if (params.jobs) {
        tests = tests.then(main => main.test('jobs', {jobs: 100}, test => {
            let jobs = params.jobs;
            if (typeof jobs === 'string' || jobs instanceof RegExp) {
                let target = {};
                serverObj.serviceBus.attachHandlers(target, [jobs]); // test specified test methods from bus
                jobs = [].concat( // convert them to an array of job definitions
                    ...Array.from(target.importedMap.entries())
                        .map(([jobName, imported]) => Object.entries(imported).map(([name, steps]) => ({
                            name: jobName + '.' + name,
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
            test.plan(jobs.length);
            jobs.forEach(job => {
                if (!job) return;
                test.test(job.name, testAny(job));
            });
        }));
    } else {
        tests = tests.then(testAny(params));
    }

    function stop(assert, x) {
        var promise = Promise.resolve();
        var steps = [];
        var step = (name, fn) => {
            promise = promise.then(fn).then(result => {
                steps.push(name);
                return result;
            }, error => {
                assert.comment(steps.join('\r\n'));
                assert.fail(name);
                return error;
            });
        };

        x.ports.forEach(port => step((port.config ? port.config.id : '?'), () => port.destroy()));
        x.serviceBus && step('bus', () => x.serviceBus.destroy());
        x.broker && step('broker', () => x.broker.destroy());
        return promise.then(() => assert.ok(true, 'destroy[' + steps.join(',') + ']'));
    }

    var stopAll = function(test) {
        stopServices(test);
        params.peerImplementations && test.test('Stopping peer implementations', {bufferred: false}, (assert) => {
            var x = Promise.resolve();
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

    var running = function() {
        setTimeout(() => log({
            error: function() {
                tap.comment(util.format(...arguments));
            }
        }), 2000);
    };

    return tests
        .then(stopAll)
        .then(running)
        .catch(e => {
            running();
            throw e;
        });
};
