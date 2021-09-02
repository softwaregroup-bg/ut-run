const { resolve } = require('path');

module.exports = [
    'ut-db',
    'ut-core',
    resolve('.')
].map(item => [{
    main: require.resolve(item),
    pkg: require.resolve(item + '/package.json')
}]);
