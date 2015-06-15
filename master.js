module.exports = {
    master:{
        create:'ut-bus',
        init:'init',
        ready:'start',
        properties:{
            server:true,
            logLevel: {$ref:'config.masterBus.logLevel'},
            socket: {$ref:'config.masterBus.socket'},
            id:'master',
            logFactory:{$ref:'log'}
        }
    }
};
