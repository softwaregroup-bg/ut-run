require('babel-register')({
    extensions: ['.jsx'],
    ignore: false
});

var tape = require('blue-tape');
var run = require('./index').run;
var loadtest = require('loadtest');

function loadTest(params, assert, bus, flow) {
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
                loadTest(params, assert, bus, flow);
            } else {
                setTimeout(() => {
                    bus.performance.stop();
                }, 5000);
            }
        });
    } else {
        if (flow.length) {
            loadTest(params, assert, bus, flow);
        }
    }
}

module.exports = function(params) {
    var client = {
        main: params.client,
        config: params.clientConfig,
        method: 'debug'
    };
    var clientRun = run(client);
    tape('Performance test start', (assert) => clientRun.then((client) => {
        params.steps(assert, client.bus, loadTest.bind(null, params));
    }));
};
