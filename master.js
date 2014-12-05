var wire = require('wire');

module.exports = wire({
    bus:{
        module:'ut-bus',
        init:'init',
        properties:{
            serverPort:3000,
            clientPort:3001,
            jsonrpc:{$ref:'jsonrpc'}
        }
    },
    jsonrpc:{
        module:'multitransport-jsonrpc'
    }
}, {require:require});
