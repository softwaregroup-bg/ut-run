require('repl').start({useGlobal: true});

var m = require('../worker');

m.then(function(ctx) {
    return ctx.run.loadPort('test', 'script', 'dev');
}).then(function(ctx) {
    ctx.port.start();
    x = ctx;
    return ctx;
}).done();
