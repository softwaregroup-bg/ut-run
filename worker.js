var wire = require('wire');

module.exports = wire({
    bus:{
        module:'ut-bus',
        init:'init',
        properties:{
            serverPort:3001,
            clientPort:3000
        }
    },
    run:{
        module:'ut-run',
        ready:'ready',
        properties:{
            bus:{$ref:'bus'},
            wire:{$ref:'wire!'}
        }
    }
}, {require:require});
