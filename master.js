var wire = require('wire');

module.exports = wire({
    host: '0.0.0.0',
    port: 30001,
    console: {
        create: 'ut-port-console',
        init: 'init',
        properties: {
            config: {
                host: {$ref: 'host'},
                port: {$ref: 'port'}
            }
        },
        ready:'start'
    },
    master:{
        create:'ut-bus',
        init:'init',
        properties:{
            serverPort:3000,
            clientPort:3001,
            id:'master'
        }
    }
}, {require:require}).then(function(ctx) {
    ctx.master.register([ctx.master.getRPC()]);
    ctx.master.subscribe([ctx.master.getPublish()]);
    return ctx;
});
