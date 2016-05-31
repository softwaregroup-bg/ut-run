require('babel-register')({
    extensions: ['.jsx'],
    ignore: false
});

var tape = require('blue-tape');
var run = require('./index').runParams;
var when = require('when');
var loadtest = require('loadtest');

function sequence(options, test, bus, flow, params) {
    return (function runSequence(flow, params) {
        var context = {
            params: params || {}
        };
        var steps = flow.map(function(f) {
            return {
                name: f.name || '',
                methodName: f.method,
                method: bus.importMethod(f.method),
                params: (typeof f.params === 'function') ? when.lift(f.params) : () => f.params,
                result: f.result,
                error: f.error
            };
        });
        var skipped = 0;

        var passed = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'p', 'Passed tests');
        var duration = options.type && bus.performance &&
            bus.performance.register(bus.config.implementation + '_test_' + options.type, 'gauge', 'd', 'Test duration');

        steps.forEach((step, index) => {
            var start = Date.now();
            (index >= skipped) && test.test(step.name || ('testing method ' + step.methodName), (methodAssert) => {
                return when(step.params.call({
                    sequence: function() {
                        return runSequence.apply(null, arguments);
                    },
                    skip: function(name) {
                        skipped = steps.length;
                        for (var i = index; i < steps.length; i += 1) {
                            if (name === steps[i].name) {
                                skipped = i;
                                break;
                            }
                        }
                    }
                }, context))
                .then((params) => {
                    if (skipped) {
                        return params;
                    }
                    return when(step.method(params))
                        .then(function(result) {
                            duration && duration(Date.now() - start);
                            passed && passed(result._isOk ? 1 : 0);
                            context[step.name] = result;
                            return result;
                        })
                        .then(function(result) {
                            if (typeof step.result === 'function') {
                                step.result.call(context, result, methodAssert);
                            };
                            return result;
                        })
                        .catch(function(error) {
                            duration && duration(Date.now() - start);
                            if (typeof step.error === 'function') {
                                step.error.call(context, error, methodAssert);
                                passed && passed(0);
                            } else {
                                passed && passed(0);
                                throw error;
                            }
                        })
                        .finally(function() {
                            bus.performance && bus.performance.write({
                                testName: options.name,
                                stepName: step.name,
                                method: step.methodName,
                                step: index
                            });
                        });
                });
            });
        });
    })(flow, params);
}

function performanceTest(params, assert, bus, flow) {
    var step = flow.shift();
    var start = Date.now();

    var passed = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'p', 'Passed tests');
    var duration = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'd', 'Test duration');
    var totalRequests = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalRequests', 'Total requests');
    var totalErrors = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'TotalErrors', 'Total errors');
    var rps = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'RpS', 'Requests per seconds');
    var meanLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MeanLatencyMS', 'Mean latency');
    var maxLatencyMs = params.name && bus.performance &&
        bus.performance.register(bus.config.implementation + '_test_' + params.name, 'gauge', 'MaxLatencyMs', 'Max latency');

    var state = true;
    if (step.inPerformanceTest) {
        var httpSettings = {
            url: params.url,
            body: Object.assign({method: step.method, params: step.params}, params.body || {jsonrpc: '2.0', 'id': 1}),
            method: params.method || 'POST',
            contentType: params.contentType || 'application/json',
            maxRequests: params.maxRequests || 10, // max requests per api call for the whole test
            concurrency: params.concurrency || 1, // threads in parallel
            statusCallback: function(latency, result) {
                if (result) {
                    step.result(JSON.parse(result.body).result, assert);
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
                    bus.performance.stop();
                }, 5000);
            }
        });
    } else {
        if (flow.length) {
            performanceTest(params, assert, bus, flow);
        }
    }
}

module.exports = function(params) {
    var client;
    if (params.type && params.type === 'performance') {
        client = {
            main: params.client,
            config: params.clientConfig,
            method: 'debug'
        };
        var clientRun = run(client);
        tape('Performance test start', (assert) => clientRun.then((client) => {
            params.steps(assert, client.bus, performanceTest.bind(null, params));
        }));
        return;
    }

    var server = {
        main: params.server,
        config: params.serverConfig,
        app: params.serverApp || '../server',
        env: params.serverEnv || 'test',
        method: params.serverMethod || 'debug'
    };
    client = params.client && {
        main: params.client,
        config: params.clientConfig,
        app: params.clientApp || '../desktop',
        env: params.clientEnv || 'test',
        method: params.clientMethod || 'debug'
    };

    var serverRun;
    tape('server start', (assert) => {
        serverRun = run(server, module.parent);
        return serverRun.then((server) =>
            client ? server : params.steps(assert, server.bus, sequence.bind(null, params))
        );
    });

    client && tape('client start', (assert) => {
        return serverRun
            .then(() => {
                clientRun = client && run(client, module.parent);
                return clientRun.then((client) =>
                    params.steps(assert, client.bus, sequence.bind(null, params))
                );
            })
            .catch(() =>
                Promise.reject('Server did not start')
            );
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
            resolve(x.master.destroy());
        }));
        return new Promise((resolve) => resolve(x));
    }

    clientRun && tape('client stop', (assert) => clientRun.then(stop.bind(null, assert)));
    tape('server stop', (assert) => serverRun
        .then(stop.bind(null, assert))
        .catch(() => Promise.reject('Server did not start'))
    );
};
