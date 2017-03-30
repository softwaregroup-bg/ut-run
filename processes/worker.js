/* eslint no-process-env:0 */
var path = require('path');
require('..')
.run({
    busType: 'worker'
}, {
    require: function(_path) {
        return require(path.join(process.env.basePath, _path));
    }
})
.then(result => {
    process.send({
        type : 'process:worker',
        data : {
            ut_event: 'ready'
        }
    });
    return result
})
.catch(err => {
    process.send({
        type : 'process:worker',
        data : {
            ut_event: 'fail'
        }
    });
    throw err;
})