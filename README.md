# UT Run

## Purpose
The module is used to start ut5 implementations which includes initialising logging, starting worker and master busses, starting performance port, creating other ports, initializing them, pass config to ports, clustering between cpu-s.

## Usage
In the root of the implementation in index.js file module ut-run should be required and its function 'run' should be called.
Sample run of implementation is node index.js.
### Sample project structure and default run of the implementation:
Default running of the implementation means that no params are passed to run function, no environment variables are passed and no rc files are used when running node index.js

By default the file structure is this:
```
implementation
│   index.js
└───server
│   ├──index.js
│   └──dev.json
```

Sample index.js file:
```js
require('ut-run').run()
```

Sample server/dev.json look like this.
```javascript
{
    "implementation": "impl-test"
}
```

Sample server/index.js look like this.
```javascript
module.exports = ({config}) => [{
    ports: [],
    modules: {},
    validations: {}
}];
```

- ports - holds ports configurations with which ut-run will instantiate corresponding port that will be registered in ut-bus. Config for every ut-port-* module can be added here. For example port registering and usage see
[ut-port-sql](https://github.com/softwaregroup-bg/ut-port-sql)
- modules - Used for registering http routes or backend methods in ut-bus
- validations - validations that will be applied on input requests
- config - param which holds merged config from default configs, dev.json, rc files

### Configuration of implementation and ports can be set in the following ways:
- In server/[environment]json file (default - server/dev.json)
- In rc file. The name of this file is .ut_[implementation]_[environment]rc where
[implementation] is implementation from server/index.js file,
[environment] is passed UT_ENV environment or 'dev' (by default)
For the sample starting the result is .ut_impl_test_devrc
Note:
In this filename there should be no dashes! Dashes from implementation (server/index.js) will be replaced with underscores!
Location on this file in windows is C:/Users/[user]
- Passing params to run function when calling index.js
This params can specify where ut-run should search for json files and index.js (in the sample above 'server' folder).
Priority of configs is in the following order rc file, [environment].json, default config.

#### special cases

* optionally in the configuration one could provide information about automatic service discovery like follows:
    ```json
        {
            ...

            registry: {
                type: 'consul',
                params: {}
            }
        }
    ```

    If you set `registry: true` then consul will be used by default trying to connect to the default consul port on `8500`.
    Currently only consul is supported as a service registry backend. For `params` specification please refer to the available consul initialization properties [here](https://github.com/silas/node-consul#consuloptions).

    In order not to use any automatic service discovery just set `registry: false` or completely omit the `registry` property.


### Environment variables and their meaning.
- UT_BUS_MODE - Allow to run masterBus and workerBus separately. Possible values are 'master', 'worker'
- UT_APP - Used to determine in which folder the implementation configuration and json files are placed. Default place is 'server' folder in the root
- UT_METHOD - Currently only 'debug' is suported. If not passed default 'debug' is used
- UT_ENV - In which environment implementation will be started and which configuration will be used. Default configuration is 'dev'. Possible values are 'dev', 'test', 'uat', 'jenkins'

### Working directory
Ut-run sets also working directory for the implementation. This folder is used for file uploads, log files. Location of this directory depends on the operating system:
- windows C:/ProgramData/SoftwareGroup/UnderTree/[implementation]
- linux /var/lib/SoftwareGroup/UnderTree/[implementation]
- macOS ~/Library/Application Support/SoftwareGroup/UnderTree/[implementation]

<br><br>
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
 
