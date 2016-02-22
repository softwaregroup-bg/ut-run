require('babel-register')({
    extensions: ['.jsx'],
    ignore: false
});

var tape = require('blue-tape');
var run = require('./index').run;
var when = require('when');

function sequence(test, bus, flow, params) {
    return (function runSequence(flow, params) {
        var context = {
            params: params || {}
        };
        var steps = flow.map(function(f) {
            return {
                name: f.name || f.method,
                method: bus.importMethod(f.method),
                params: (typeof f.params === 'function') ? when.lift(f.params) : () => f.params,
                result: f.result,
                error: f.error
            };
        });
        var skipped = false;

        steps.forEach(step => {
            test.test('testing method ' + step.name, (methodAssert) => {
                skipped = false;
                return new Promise(resolve => {
                    resolve(step.params.call({
                        sequence: function() {
                            return runSequence.apply(null, arguments);
                        },
                        skip: function() {
                            skipped = true;
                        }
                    }, context));
                })
                .then(params => {
                    if (skipped) {
                        return params;
                    }
                    /* console.time(step.signature);*/
                    return step.method(params)
                        .then(function(result) {
                            /* console.log('\n\n\n\n--------------------------');
                            console.timeEnd(step.signature);
                            console.dir(step);
                            console.log('--------------------------\n\n\n\n');*/
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
                            if (typeof step.error === 'function') {
                                step.error.call(context, error, methodAssert);
                            } else {
                                throw error;
                            }
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
    var client = {
        main: params.client,
        config: params.clientConfig,
        method: 'debug'
    };

    var serverRun = run(server);
    var clientRun = run(client);
    tape('server start', assert => serverRun);
    tape('client start', assert => clientRun.then(client => params.steps(assert, client.bus, sequence)));

    function stop(assert, x) {
        x.ports.forEach(port => {
            assert.test('stopping port ' + port.config.id, assert => new Promise(resolve => {
                resolve(port.stop());
            }));
        });
        assert.test('stopping worker bus', assert => new Promise(resolve => {
            resolve(x.bus.destroy());
        }));
        assert.test('stopping master bus', assert => new Promise(resolve => {
            resolve(x.master.destroy());
        }));
        return new Promise(resolve => resolve(x));
    }
    tape('client stop', assert => clientRun.then(stop.bind(null, assert)));
    tape('server stop', assert => serverRun.then(stop.bind(null, assert)));
};
