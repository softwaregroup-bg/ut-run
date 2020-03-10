const tap = require('tap');
const { getConfig } = require('..');
const clean = obj => {
    delete obj.params.appname;
    delete obj.params.env;
    return obj;
};

tap.test('getConfig', assert => {
    assert.matchSnapshot(clean(getConfig({
        config: {}
    })), 'load configuration');

    assert.end();
});
