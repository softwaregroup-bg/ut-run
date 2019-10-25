# Automated tests

ut-run provides a standard way of structuring automated tests.

## Properties

- `type`: the type of the test (integration)
- `name`: the name of the test ('Add test', 'test.test')
- `server`: the tested server, it will be started before the test starts and
  stopped after the test finishes
- `serverConfig`: specific server configuration
- `client`: the tested client, it will be started before the test starts and
  stopped after the test finishes
- `clientConfig`: specific client configuration
- `services`: one or set of services to be started before the server and to be
  stopped after the test finishes (for example different application)
- `jobs`: set of tests to be executed (a specified module could be required and
  all tests in it will be run)
- `exclude`: used with jobs, excludes tests from the run, could be a string,
  array or regExp
- `steps`: the test steps (login, add user, etc.)

## Sample test script with jobs

```js
var test = require('ut-run/test');
test({
  type: 'integration',
  name: 'test.test',
  server: config.server,
  serverConfig: config.serverConfig,
  client: config.client,
  clientConfig: config.clientConfig,
  services: require('../index-test'),
  exclude: [test1, test2],
  jobs: require('ut-test/test/integration')
});
```

## Sample test script with steps

```js
type: 'integration',
name: 'test.test',
steps: function(test, bus, run) {
    return run(test, bus, [{
        name: 'name1',
        method: 'bus.method.name1'
        params: (context1, utils) => {
            },
        result: (result, assert) => {
            return assert; // do some assertions for bus.method.name1
        }
    },
    {
        name: 'name 2',
        params: (context, utils) => {
            if (someCondition === 1) {
                return utils.skip(); // skip step
            }
        },
        steps: () => someArray.map(org => ({
            name: 'name 3',
            steps: () => [
                {
                    name: 'subtest 1',
                    method: 'bus.method.name3'
                    params: (context1, utils) => {
                        },
                    error: (error, assert) => {
                        return assert; // do some assertions for bus.method.name3
                    }
                }]
        }))
    }
    ]);
}
```

## Sample output

```sh
ok 1 - test.test # time=87662.851ms {
# Subtest: client start
1..0
ok 1 - client start # time=895.482ms
# Subtest: name 1
ok 1 - return assertion
1..1
ok 2 - name 1 # time=2276.166ms
# Subtest: name 2
# Subtest: name 3
# Subtest: subtest 1
ok 1 - return assertion
1..1
ok 1 - subtest 1 # time=1498.608ms
1..1
ok 1 - name 3 # time=10379.087ms
1..1
ok 3 - name 2 # time=10380.526ms
# Subtest: client stop
ok 1 - stopped port backend
ok 2 - stopped bus
ok 3 - stopped broker
1..3
ok 4 - client stop # time=0.464ms

1..4
}
```

### Sample output with skipped step

```sh
ok 1 - test.test # time=87662.851ms {
# Subtest: client start
1..0
ok 1 - client start # time=895.482ms
# Subtest: name 1
ok 1 - return assertion
1..1
ok 2 - name 1 # time=2276.166ms
# ^ name2 - skipped
# Subtest: client stop
ok 1 - stopped port backend
ok 2 - stopped bus
ok 3 - stopped broker
1..3
ok 3 - client stop # time=0.464ms

1..3
}
```
