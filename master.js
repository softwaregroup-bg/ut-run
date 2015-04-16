module.exports = {
    console: {
        create: 'ut-port-console',
        init: 'init',
        properties: {
            config: {
                host: {$ref: 'consoleHost'},
                port: {$ref: 'consolePort'}
            }
        },
        ready:'start'
    },
    master:{
        create:'ut-bus',
        init:'init',
        properties:{
            serverPort: {$ref: 'serverPort'},
            clientPort: {$ref: 'clientPort'},
            id:'master'
        },
        ready:'start'
    }
};
