require('babel-register')({
    extensions: ['.jsx'],
    ignore: false
});

var tape = require('blue-tape');
var run = require('./index').run;
var when = require('when');

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
            (index >= skipped) && test.test('testing method ' + step.name, (methodAssert) => {
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
                            bus.performance && bus.performance.write({testName: options.name, stepName: step.name, method: step.methodName, step: index});
                        });
                });
            });
        });
    })(flow, params);
}
module.exports = function(params) {
    var server = {
        main: params.server,
        config: params.serverConfig,
        method: 'debug'
    };
    var client = params.client && {
        main: params.client,
        config: params.clientConfig,
        method: 'debug'
    };

    var serverRun = run(server);
    var clientRun = client && run(client);
    tape('server start', (assert) => serverRun.then((server) => client ? server : params.steps(assert, server.bus, sequence.bind(null, params))));
    client && tape('client start', (assert) => clientRun.then((client) => params.steps(assert, client.bus, sequence.bind(null, params))));

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
    client && tape('client stop', (assert) => clientRun.then(stop.bind(null, assert)));
    tape('server stop', (assert) => serverRun.then(stop.bind(null, assert)));
};
