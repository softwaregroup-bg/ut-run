require('babel-register')({
    extensions: ['.jsx'],
    ignore: false
});

var tape = require('blue-tape');
var run = require('./index').run;
var loadtest = require('loadtest');
var timers = {};
var passed = true;

function loadtest_test(assert, bus, flow) {
    var step = flow.shift();
    timers[step.name] = { start: Date.now() };
    timers[step.name].state = true;
    if (step.inPerformanceTest) {
        var httpSettings = {
            url: 'http://localhost:8003/rpc',  // @TODO: discuss better way to make url and body reusable for other methods
            body: { jsonrpc: '2.0', method: step.method, params: step.params, "id": 1234 },
            method: 'POST',
            contentType: 'application/json',
            maxRequests: 10, // max requests per api call for the hole test
            concurrency: 1, //threads in parallel
            statusCallback: function(latency, result) {
                if (result) {
                    step.result(JSON.parse(result.body).result, assert);
                }
                timers[step.name].state = timers[step.name].state && assert.ok && result;
            }
        };
        return new Promise(function (resolve) {
            loadtest.loadTest(httpSettings, function (error, result) {
                resolve(result);
            });
        }).then(function (result) {
            timers[step.name].time = Date.now() - timers[step.name].start;
            var state = timers[step.name].state ? 'passed' : 'failed';
            var measurement = 'testing4'; // @TODO: discuss better way to speficy measurement name
            
            var tags = 'TestName="'+ step.name + '"' + ',TestMethod="'+ step.method + '"' + ',TestState="'+ state + '"' + ',TestDuration='+ timers[step.name].time + ',TotalRequests='+ result.totalRequests + ',TotalErrors='+ result.totalErrors + ',RpS='+ result.rps + ',MeanLatencyMS='+ result.meanLatencyMs + ',MaxLatencyMs='+ result.maxLatencyMs;
            if (result.errorCodes) {
                var keys = Object.keys(result.errorCodes);
                keys.map(function(key) {
                    tags = tags + ',ErrorCode' + key + '='+result.errorCodes[key];
                })
            }
            var message = measurement + ' ' + tags;
            bus.performance.write(message);
            if (flow.length) {
                loadtest_test(assert, bus, flow);
            }
        });       
    } else {
        if (flow.length) {
            loadtest_test(assert, bus, flow);
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
    tape('Performance test start', (assert) => {
        clientRun.then(client => params.steps(assert, client.bus, loadtest_test));
    });
};
