// var log = require('why-is-node-running');
var tap = require('tap');
var run = require('./index');
var loadtest = require('loadtest');

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
    return (function runSequence(flow, params, parent) {
        var context = parent || {
            params: params || {}
        };
        var steps = flow.map(function(f) {
            if (!f.name) {
                throw new Error('step name is required');
            }
            return {
                name: f.name,
                methodName: f.method,
                method: f.method ? bus.importMethod(f.method) : (params) => Promise.resolve(params),
                params: (typeof f.params === 'function') ? promisify(f.params) : () => Promise.resolve(f.params),
                steps: f.steps,
                result: f.result,
                error: f.error
            };
        });
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
                        return step.method(params)
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

                return test.test(getName(step.methodName ? (step.methodName + ' // ' + step.name) : step.name), {skip: !passing}, fn);
            });
        });
        return promise.catch(test.threw);
    })(flow, params, parent);
}

function performanceTest(params, assert, bus, flow) {
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
                tests: tap.test('*** Reusing cache for ' + params.name, (assert) => params.steps(assert, cache.bus, sequence.bind(null, params), cache.ports))
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
    if (Array.isArray(params.services)) {
        tap.test('Starting services...', {bufferred: false}, (assert) => {
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
            }, Promise.resolve())
            .catch((e) => {
                return stopServices(assert)
                    .then(() => Promise.reject(e));
            });
        });
    }

    var clientRun;

    if (params.type && params.type === 'performance') {
        clientConfig = {
            main: params.client,
            config: params.clientConfig,
            method: 'debug'
        };
        clientRun = run.run(clientConfig);
        tap.test('Performance test start', (assert) => clientRun.then((client) => {
            params.steps(assert, client.bus, performanceTest.bind(null, params), client.ports);
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
    var testObj;
    // tap.jobs = 1;
    var tests = tap.test('server start', {bufferred: false, bail: true}, assert => {
        serverRun = run.run(serverConfig, module.parent, assert);
        return serverRun.then((server) => {
            testObj = server;
            !clientConfig && cache && (cache.bus = server.bus) && (cache.ports = server.ports);
            var result = clientConfig ? server : Promise.all(server.ports.map(port => port.isReady));
            return result;
        });
    });

    clientConfig && (tests = tap.test('client start', {bufferred: false, bail: true}, assert => {
        return serverRun
            .then(server => {
                clientConfig.config && (clientConfig.config.server = () => server);
                clientRun = clientConfig && run.run(clientConfig, module.parent, assert);
                return clientRun.then((client) => {
                    testObj = client;
                    cache && (cache.bus = client.bus) && (cache.ports = client.ports);
                    return Promise.all(client.ports.map(port => port.isReady));
                });
            });
    }));

    tests = tests.then((test) => params.steps(test, testObj.bus, sequence.bind(null, params), testObj.ports));

    function stop(assert, x) {
        var promise = Promise.resolve();
        var step = (name, fn) => {
            promise = promise.then(fn).then(result => {
                assert.ok(true, name);
                return result;
            }, error => {
                assert.fail(name);
                return error;
            });
        };

        x.ports.forEach(port => step('stopped port ' + port.config.id, () => port.stop()));
        step('stopped worker bus', () => x.bus.destroy());
        step('stopped master bus', () => x.master.destroy());
        return promise;
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
        clientConfig && test.test('client stop', {bufferred: false}, assert => clientRun.then(result => stop(assert, result)));
        return test.test('server stop', {bufferred: false}, assert => serverRun
            .then(result => stop(assert, result))
            .catch(() => Promise.reject(new Error('Server did not start')))
        );
    };

    return tests.then(stopAll);
};
