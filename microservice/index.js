const { resolve } = require('path');

require('../').run({
    method: 'debug',
    version: require(resolve('package.json')).version,
    root: __dirname,
    resolve: require.resolve
});
