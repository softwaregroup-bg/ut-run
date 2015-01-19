require('repl').start({useGlobal: true});

require('when/monitor/console');
var w = require('../worker');
var m = require('../master');
var when = require('when');

w.then(function(ctx) {
    return when.all([
        ctx.run.loadPort('test', 'script', 'dev').then(function(ctx) {
            ctx.port.start();
            script = ctx;
            return ctx;
        }),
        ctx.run.loadPort('test', 'atm', 'dev').then(function(ctx) {
            ctx.port.start();
            atm = ctx;
            return ctx;
        })
    ]);
}).done();

m.then(function(ctx) {
    master = ctx;
}).done();
