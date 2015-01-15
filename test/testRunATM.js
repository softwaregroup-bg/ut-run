var m = require('../worker');

m.then(function(ctx) {
    return ctx.run.loadPort('test', 'atm', 'dev');
}).then(function(ctx) {
    ctx.port.start();
    x = ctx;
    return ctx;
}).done();
