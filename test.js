// var log = require('why-is-node-running');
var tape = require('blue-tape');
var run = require('./index');
var loadtest = require('loadtest');

function promisify(fn) {
    return function() {
        return new Promise(resolve => resolve(fn.apply(this, arguments)));
    };
}

function sequence(options, test, bus, flow, params) {
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
    return (function runSequence(flow, params) {
        var context = {
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
                result: f.result,
                error: f.error
            };
        });
        var passed = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'p', 'Passed tests');
        var duration = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'd', 'Test duration');

        var promise = Promise.resolve();
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
                test.comment(getName(step.name));
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
                    return step.method(params)
                        .then(function(result) {
                            duration && duration(Date.now() - start);
                            passed && passed(result._isOk ? 1 : 0);
                            performanceWrite();
                            context[step.name] = result;
                            if (typeof step.result === 'function') {
                                step.result.call(context, result, test);
                            } else if (typeof step.error === 'function') {
                                test.fail('Result is expected to be an error');
                            } else {
                                test.fail('Test is missing result and error handlers');
                            }
                            return result;
                        })
                        .catch(function(error) {
                            duration && duration(Date.now() - start);
                            passed && passed(0);
                            performanceWrite();
                            if (typeof step.error === 'function') {
                                step.error.call(context, error, test);
                            } else {
                                throw error;
                            }
                        });
                })
                .catch((error) => test.error(error));
            });
        });
        return promise;
    })(flow, params);
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
    assert.test(step.name || ('testing method ' + step.methodName), (methodAssert) => {
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
    var client;
    if (cache) {
        if (!cache.first) {
            cache.first = true;
            if (params.peerImplementations) {
                tape('Starting peer implementations...', (assert) => Promise.all(params.peerImplementations));
            }
        } else {
            tape('*** Reusing cache for ' + params.name, (assert) => params.steps(assert, cache.bus, sequence.bind(null, params), cache.ports));
            return;
        }
    }

    var clientRun;

    if (params.type && params.type === 'performance') {
        client = {
            main: params.client,
            config: params.clientConfig,
            method: 'debug'
        };
        clientRun = run.run(client);
        tape('Performance test start', (assert) => clientRun.then((client) => {
            params.steps(assert, client.bus, performanceTest.bind(null, params), client.ports);
            return true;
        }));
        return;
    }

    var server = {
        main: params.server,
        config: params.serverConfig,
        app: params.serverApp || '../../server',
        env: params.serverEnv || 'test',
        method: params.serverMethod || 'debug'
    };
    client = params.client && {
        main: params.client,
        config: params.clientConfig,
        app: params.clientApp || '../../desktop',
        env: params.clientEnv || 'test',
        method: params.clientMethod || 'debug'
    };

    var serverRun;
    tape('server start', (assert) => {
        serverRun = run.run(server, module.parent);
        return serverRun.then((server) => {
            !client && cache && (cache.bus = server.bus) && (cache.ports = server.ports);
            var result = client ? server : Promise.all(server.ports.map(port => port.isReady)).then(() =>
                params.steps(assert, server.bus, sequence.bind(null, params), server.ports));
            return result;
        });
    });

    client && tape('client start', (assert) => {
        return serverRun
            .then(() => {
                clientRun = client && run.run(client, module.parent);
                return clientRun.then((client) => {
                    cache && (cache.bus = client.bus) && (cache.ports = client.ports);
                    return Promise.all(client.ports.map(port => port.isReady)).then(() =>
                        params.steps(assert, client.bus, sequence.bind(null, params), client.ports));
                });
            });
    });

    function stop(assert, x) {
        x.ports.forEach((port) => {
            assert.test('stopping port ' + port.config.id, (assert) => new Promise((resolve) => {
                resolve(port.stop());
            }));
        });
        assert.test('stopping worker bus', (assert) => new Promise((resolve) => {
            resolve(x.bus.destroy());
        }));
        assert.test('stopping master bus', (assert) => new Promise((resolve) => {
            resolve(x.master.destroy().then(function(res) {
                // log();
                return res;
            }));
        }));
        return new Promise((resolve) => resolve(x));
    }

    var stopAll = function() {
        params.peerImplementations && tape('Stopping peer implementations', (assert) => {
            var x = Promise.resolve();
            params.peerImplementations.forEach((promise) => {
                x = x.then(() => (promise.then((impl) => (impl.stop()))));
            });
            return x;
        });
        client && tape('client stop', (assert) => clientRun.then(stop.bind(null, assert)));
        tape('server stop', (assert) => serverRun
            .then(stop.bind(null, assert))
            .catch(() => Promise.reject(new Error('Server did not start')))
        );
    };

    return cache ? stopAll : stopAll();
};
