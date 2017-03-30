/* eslint no-process-env:0 */
// console.log('process.env.NODE_PATH', process.env.NODE_PATH, '\n\n\n\n\n')
// console.log('process.argv', process.argv, '\n\n\n\n\n\n')
// console.log('process.execArgv', process.execArgv, '\n\n\n\n\n\n')
var path = require('path');
require('..')
.run({
    busType: 'master'
}, {
    require: function(_path) {
        return require(path.join(process.env.basePath, _path));
    }
})
.then(result => {
    process.send({
        type : 'process:master',
        data : {
            ut_event: 'ready'
        }
    });
    return result
})
.catch(err => {
    process.send({
        type : 'process:master',
        data : {
            ut_event: 'fail'
        }
    });
    throw err;
})