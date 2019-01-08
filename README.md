# UT Run

## Purpose

The module is used to start ut5 implementations which includes initialising
logging, starting bus and broker, starting performance port, creating
other ports, initializing them, pass config to ports, clustering between cpu-s.

## Usage

In the root of the implementation in index.js file module ut-run should be
required and its function 'run' should be called.
Sample run of implementation is `node index`.

### Recommended project structure and default run of the implementation

The recommended filesystem structure, when running only one service looks like this:

    implementation
    ├───index.js
    └───server
        ├──common.js     - common configuration for all environments
        ├──index.js      - service startup file
        ├──prod.json     - environment configuration file
        ├──test.json     - environment configuration file
        └──dev.json      - environment configuration file

The file `index.js` in the root is used to start the implementation.
Typical `index.js` file looks like:

```js
require('ut-run').run({version: require('./package.json').version});
```

It uses `ut-run` package to start the implementation and passes the version to it.

### Starting

Starting the implementation from the command line can be done by passing these
command line arguments:

```bash
node index {app} {method} {env}
```

- `{app}` - specifies the name of sub-folder, where to find the app/service to
  start. Defaults to 'server'.
- `{method}` - specifies the way of running, currently only the 'debug' is
  supported, while in future other modes can be supported. Defaults to 'debug'.
- `{env}` - specifies the name of configuration file related to the environment.
  Environments like 'dev', 'prod' and 'test' are commonly used. Defaults to 'dev'.

Using environment variables is also possible

```bash
UT_APP=server UT_METHOD=debug UT_ENV=dev node index
```

When multiple services exists in a single implementation, usually the folder
structure is:

    implementation
    │   index.js
    └───server
        ├──service1
        │   ├──common.js
        │   ├──index.js
        │   ├──prod.json
        │   ├──test.json
        │   └──dev.json
        └──service2
            ├──common.js
            ├──index.js
            ├──prod.json
            ├──test.json
            └──dev.json

To run specific service in such cases, either set `UT_APP=server/service1` or
pass as argument `node index server/service1`

### Environment configuration files

Environment configuration files can be either `.json` or `.js` file.
If it is a `.js` file, it must export an object. If a file named `common.js` or
`common.json` exists, it is used as a base object for all environments where the
actual environment configuration is merged. When using `.js` file, more complex
configuration is possible - like having functions or other objects, not
supported by JSON. Minimal environment file `server/dev.json` may look like:

```json
{
    "implementation": "impl-test",
    "service": "admin"
}
```

### Services

Service startup file `server/index.js` are recommended to follow this pattern:

```javascript
module.exports = ({config}) => [
    package1,
    package2,
    //...
    packageN
];
```

The `config` parameter holds the environment configuration and can be used to
implement complex logic, when the default logic is not sufficient.
It is not recommended to pass this configuration to the packages, as they should
only be allowed to access their own section within the configuration.

Usually `packageX` is eiter reusing some standard functionality
`require('ut-something')` or some implementation specific functionality
`require('../something')` or inlining this structure:

```js
{
    ports:[],
    modules:{},
    validations:{},
    errors: []
}
```

### Business module packages

Business module packages usually represent a related set of business
functionality, that is either available as npm package or is developed within
the implementation. Each package is either an object with the above structure or
a function, returning such object:

```javascript
function utPackageName(packageConfig) {
    return {
        ports: [
            port1,
            port2,
            // ...
            portN
        ],
        modules: {
            module1: module1,
            module2: module2,
            //...
            module2: moduleN
        },
        validations: {
            validation1: validation1,
            validation2: validation2,
            //...
            validation1: validation1
        },
        errors: [
            errors1,
            errors2,
            //...,
            errorsN
        ]
    }
}
```

Parameters:

- `packageConifig` - if the function has name, then the passed parameter value
  is taken from the environment configuration property with the same name.
  Otherwise, `undefined` is passed. Loading of the whole package can be turned
  off from environment configuration by setting the mentioned property to `false`

Return value:

- `ports` - array of port configuration objects or functions, that return port
  configuration objects. In cases when a named function is used, the function
  will be invoked with a parameter that equals the environment configuration
  property with name same as the name of the function. In these cases the port
  configuration object returned by the function may skip the 'id' property and
  the port will have id that equals the function name. Ports can be excluded by
  setting `false` the configuration property that corresponds to the port name.
- `modules` - holds a map of the used modules. Each property can be an object or
  function. If it is a function, then it will be called with a value taken from
  the environment configuration. The value is taken by first looking for a
  property named after the name of the package function (utPackageName in the
  above example), then within that object a the value of a property that equals
  the module name is taken. When using named function, the module can be
  excluded by setting `false` the mentioned property.
- `validations` - validations that will be applied on input requests.
  Validations can again be objects or functions. For functions, the same way of
  passing configuration applies as explained for `modules`.
- `errors` - array of error factory functions that will be invoked with error
  api argument.

In addition to using environment configuration files within the implementation,
the following additional options are available, which will override the configuraiton

- Configuration file
- Using command line parameters
- Using environment variables

The algorithm of how these are applied is described in the `rc` package, [here](https://github.com/dominictarr/rc).
This is adapted from `rc` package readme:

- command line arguments, parsed by minimist _(e.g. `--foo baz`, also nested: `--foo.bar=baz`)_
- environment variables prefixed with `ut_${impl}_${env}_`
  - or use "\_\_" to indicate nested properties _(e.g.
  `ut_${impl}_${env}_foo__bar__baz` => `foo.bar.baz`)_
- if you passed an option `--config file` then from that file
- a local `.ut_${impl}_${env}rc` or the first found looking in
  `./ ../ ../../ ../../../` etc.
- `$HOME/.ut_${impl}_${env}rc`
- `$HOME/.ut_${impl}_${env}/config`
- `$HOME/.config/ut_${impl}_${env}`
- `$HOME/.config/ut_${impl}_${env}/config`
- `/etc/ut_${impl}_${env}rc`
- `/etc/ut_${impl}_${env}/config`
- the object taken from environment configuration file within service folder
  (dev.js[on], test.js[on], etc.)

All configuration sources that were found will be flattened into one object,
so that sources **earlier** in this list override later ones.

${impl} is implementation identifier taken from environment configuration file,
${env} is the environment passed throu command line or UT_ENV environment
variable, or 'dev' (by default)

### Example

The example below illustrates the way configuration is passed to business module
packages, ports, modules and validations.
For brevity, the usual `require('...')` calls are inlined.

- `server/dev.json`

```json
{
    "businessPackage1": {
        "module1": {
        },
        "validation1": {
        }
    },
    "businessPackage2": {
        "module1": {
        },
        "validation1": {
        }
    },
    "port1": {
    },
    "port2": {
    },}
```

- `server/index.js`

```js
module.exports = [
    function businessPackage1(b1) {
        // b1 will equal to businessPackage1 taken under configuration root
        return {
            ports: [
                function port1(p1) {
                    // p1 will equal to port1 taken under configuration root
                    return {
                        createPort: require('ut-port-sql')
                    }
                },
                {
                    id: 'port2', // this port configuration object will be
                                 //merged with port2 taken under configuration root
                    createPort: require('ut-port-http')
                }
            ],
            modules: {
                module1: m1 => ({/* some methods */}),
                // m1 will equal to module1 under businessPackage1 under
                // configuration root
                module2: {/* some methods */}
            },
            validations: {
                validation1: v1 => {/* joi validations */},
                // v1 will equal to validation1 under businessPackage1 under
                // configuration root
                validation2: {/* joi validations */}
            },
            errors: [
                ({defineError, getError, fetchErrors}) =>
                // error api will be passed as argument
                {
                    // error definitions
                }
            ]
        };
    },
    function businessPackage1(b2) {
        // b2 will equal to businessPackage1 taken under configuration root
        // return {ports, modules, validations}
    }
]
```

### Special cases

- optionally in the configuration one could provide information about automatic
  service discovery like follows:
    ```json
        {
            "registry": {
                "type": "consul",
                "params": {}
            }
        }
    ```

    If you set `registry: true` then consul will be used by default trying to
    connect to the default consul port on `8500`. Currently only consul is
    supported as a service registry backend. For `params` specification please
    refer to the available consul initialization properties
    [here](https://github.com/silas/node-consul#consuloptions).

    In order not to use any automatic service discovery just set
    `registry: false` or completely omit the `registry` property.

### Additional environment variables

- UT_BUS_MODE - Allow to run broker and bus separately.
  Possible values are 'broker', 'bus'

### Working directory

ut-run sets also working directory for the implementation. This folder is used
for file uploads, log files. Location of this directory depends on the
operating system:

- windows C:/ProgramData/SoftwareGroup/UnderTree/[implementation]
- linux /var/lib/SoftwareGroup/UnderTree/[implementation]
- macOS ~/Library/Application Support/SoftwareGroup/UnderTree/[implementation]

## Automated tests

ut-run provides a standard way of structuring automated tests.

### Properties

- type: the type of the test (integration)
- name: the name of the test ('Add test', 'test.test')
- server: the tested server, it will be started before the test starts and
  stopped after the test finishes
- serverConfig: specific server configuration
- client: the tested client, it will be started before the test starts and
  stopped after the test finishes
- clientConfig: specific client configuration
- services: one or set of services to be started before the server and to be
  stopped after the test finishes (for example different implementation)
- jobs: set of tests to be executed (a specified module could be required and
  all tests in it will be run)
- exclude: used with jobs, exludes tests from the run, could be a string,
  array or regExp
- steps: the test steps (login, add user, etc.)

### Sample test script with jobs

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

### Sample test script with steps

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

### Sample output

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
