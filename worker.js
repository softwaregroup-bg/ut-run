module.exports = {
    bus: {
        create: 'ut-bus',
        init: 'init',
        properties: {
            server:false,
            logLevel: {$ref:'config.workerBus.logLevel'},
            socket: {$ref:'config.masterBus.socket'},
            id:'worker',
            logFactory:{$ref:'log'}
        }
    },
    run: {
        module: 'ut-run',
        ready: 'ready',
        properties: {
            bus: {$ref: 'bus'},
            wire: {$ref: 'wire!'}
        }
    }
};
