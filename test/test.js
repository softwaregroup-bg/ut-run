var m = require('../worker');

m.then(function(ctx) {
    return ctx.run.load('test', 'test', 'dev');
}).then(function(ctx) {
    x = ctx;
}).done();
