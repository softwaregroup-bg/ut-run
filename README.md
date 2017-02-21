# UT Run

## Run subtests

### Sample test script:
```js
var test = require('ut-run/test');
test({
  type: 'type',
  name: 'name',
  server: config.server,
  serverConfig: config.serverConfig,
  client: config.client,
  clientConfig: config.clientConfig,
  steps: function (test, bus, run) {
    return run(test, bus, [{
        name: 'name1',
        method: 'bus.method.name1'
        params: (context1, utils) => {
            return utils.sequence([{
                name: 'name2',
                method: 'bus.method.name2'
                params: (context2, utils) => {
                    if (someCondition) {
                        return utils.skip(); // skip step
                    }
                    return utils.sequence([{
                        name: 'name3',
                        method: 'bus.method.name3'
                        params: (context3, utils) => {
                            return {}; // params for bus.method.name3
                        },
                        result: (result, assert) => {
                            return assert; // do some assertions for bus.method.name3
                        }
                    }])
                    .then(() => {
                        return {}; // params for bus.method.name2
                    })
                },
                result: (result, assert) => {
                    return assert; // do some assertions for bus.method.name2
                }
            }])
            .then(() => {
                return {}; // params for bus.method.name1
            })

        },
        result: (result, assert) => {
            return assert; // do some assertions for bus.method.name1
        }
    }]);
  }
});
```
### Sample output:

```sh
# name1
# -> subtest start: [name1]
# name2
# --> subtest start: [name2]
# name3
ok 1 return assertion for name 3
# <-- subtest end: [name2]
ok 2 return assertion for name 2
# <- subtest end: [name1]
ok 3 return assertion for name 1
```
### Sample output with skipped step:

```sh
# name1
# -> subtest start: [name1]
# name2
# ^ name2 - skipped
# <- subtest end: [name1]
ok 3 return assertion for name 1
```
