# UT Run

## Purpose

The module is used to start UT applications by initializing
logging, starting bus and optional broker and then creating and initializing ports,
modules and validations.

## Usage

In the root of the application in file `index.js`, the  module `ut-run` should
be required and its function 'run' should be called.
The file `index.js` in the root is used to start the application.
Typical `index.js` file looks like:

```js
let run = module.exports = params => require('ut-run').run({
    version: require('./package.json').version,
    root: __dirname,
    resolve: require.resolve,
    params
});

if (require.main === module) run();
```

It uses `ut-run` package to start the application and passes the package
version to it.

### Starting

Starting the application from the command line can be done by passing these
command line arguments:

```bash
node index {app} {method} {env}
```

- `{app}` - specifies the name of sub-folder, where to find the app server to
  start. Defaults to 'server'.
- `{method}` - specifies the way of running, defaults to 'debug'. The following
  methods are available:
  - `debug` - start the server
  - `install` - generate configuration for various installation targets
- `{env}` - specifies the name of configuration file related to the environment.
  Environments like 'dev', 'prod' and 'test' are commonly used. Defaults to 'dev'.

Using environment variables is also possible

```bash
UT_APP=server UT_METHOD=debug UT_ENV=dev node index
```

### Recommended application structure

The recommended filesystem structure, when running only one server looks like this:

```text
application
├───index.js
└───server
    ├──common.js     - common configuration for all environments
    ├──install.json  - configuration applied during installation
    ├──debug.json    - configuration applied during debugging
    ├──index.js      - server startup file
    ├──prod.json     - environment configuration file
    ├──test.json     - environment configuration file
    └──dev.json      - environment configuration file
```

When multiple servers exists in a single application, usually the folder
structure is:

```text
application
├───index.js
└───server
    ├──server1
    │   ├──common.js
    │   ├──index.js
    │   ├──prod.json
    │   ├──test.json
    │   └──dev.json
    └──server2
        ├──common.js
        ├──index.js
        ├──prod.json
        ├──test.json
        └──dev.json
```

To run specific server in such cases, either set `UT_APP=server/server1` or
pass as argument `node index server/server1`

### Configuration

`ut-run` uses `ut-config` to load or edit the application configuration. For more
information consult the [README](https://github.com/softwaregroup-bg/ut-config) there.

When running an application with `ut-run.run`
in standard (debug) mode you can take advantage
of `ut-config` [templating capabilities](https://github.com/softwaregroup-bg/ut-config#templating).
In other words everything explained
there (including the encrypt/decrypt methods)
can be applied when loading configuration.

E.g.

```javascript
require('ut-run').run({
    context: {
        test: params => {/* do something*/} // or some function or something else
        // ...other context properties
    }
    // ...other run properties
});
```

Then in all configuration files
(no matter whether they are rc, json, etc.) you can use
the specified context as '${test(...something)}'

### Servers

Server startup file `server/index.js` is recommended to follow this pattern:

```javascript
module.exports = function({config}) {
    return [{
        main: require.resolve('ut-telemetry'),
        pkg: require.resolve('ut-telemetry/package.json')
    }, {
        main: require.resolve('ut-module1'),
        pkg: require.resolve('ut-module1/package.json')
    }, {
        // ...
    }, {
        main: require.resolve('moduleN'),
        pkg: require.resolve('moduleN/package.json')
    }].filter(item => item).map(item => [item, ...arguments]);
};
```

The `config` parameter holds the environment configuration and can be used to
implement more complex logic, when the default logic is not sufficient.
It is not recommended to pass this configuration to the packages, as they should
only be allowed to access their own section within the configuration.

Usually modules are either reusing some standard functionality
`require('ut-something')` or some application specific functionality
`require('../impl/something')`.
See [composable microservices](./microservices.md) for detailed description of
module structure and configuration.
See [standard UnderTree module structure](https://github.com/softwaregroup-bg/ut-standard)
for recommended practical structure for modules.

### Working directory

`ut-run` sets also the working directory for the application. This folder is used
for temporary file uploads, log files, etc. and must be writeable. Location of
this directory depends on the operating system:

- Windows: C:/ProgramData/SoftwareGroup/UnderTree/{implementation-name}
- Linux: /var/lib/SoftwareGroup/UnderTree/{implementation-name}
- MacOS: ~/Library/Application Support/SoftwareGroup/UnderTree/{implementation-name}

### Unit tests

There are 2 ways of unit-testing a port:

- specify steps as in integration tests.

```js
require('ut-run').run({
    main: require('..'),
    method: 'unit',
    config: {
        SqlPort: {
            allowQuery: true,
            connection: {
                server: 'utPortTestDbServer',
                database: 'ut-port-sql-test',
                user: 'utPortTestDbUser',
                password: 'utPortTestDbPassword'
            },
            create: {
                user: 'utPortTestDbCreateUser',
                password: 'utPortTestDbCreatePassword'
            }
        }
    },
    params: {
        steps: [
            {
                method: 'SqlPort.query',
                name: 'exec',
                params: {
                    query: 'SELECT 1 AS test',
                    process: 'json'
                },
                result: (result, assert) => {
                    assert.true(Array.isArray(result.dataSet));
                    assert.equals(result.dataSet[0].test, 1);
                }
            }
        ]
    }
});
```

- Write arbitrary unit tests.

If you don't want to use predefined steps
but to write any type of tests in functional
or snapshot manner then just omit
the steps from the ut-run configuration object
like this:

```js
require('ut-run').run({
    main: require('..'),
    method: 'unit',
    config: {
        SqlPort: {
            allowQuery: true,
            connection: {
                server: 'utPortTestDbServer',
                database: 'ut-port-sql-test',
                user: 'utPortTestDbUser',
                password: 'utPortTestDbPassword'
            },
            create: {
                user: 'utPortTestDbCreateUser',
                password: 'utPortTestDbCreatePassword'
            }
        }
    },
    params: { // or omit the entire params property
        // steps: [
        //     {
        //         method: 'SqlPort.query',
        //         name: 'exec',
        //         params: {
        //             query: 'SELECT 1 AS test',
        //             process: 'json'
        //         },
        //         result: (result, assert) => {
        //             assert.true(Array.isArray(result.dataSet));
        //             assert.equals(result.dataSet[0].test, 1);
        //         }
        //     }
        // ]
    }
}).then(async({serviceBus, stop}) => {
    // write arbitrary tests
    // call serviceBus.importMethod to invoke port methods
    // call stop() once done
});
```

### Documentation

Ut-run provides a bin script for automatic
port configuration documentation.

In order to generate a configuration
documentation for a given port you need
to add `ut-run`and `json-schema-to-markdown` as
devDependencies and `ut-doc` as `doc` script
in its `package.json`.

E.g.

```json
{
    "scripts": {
        "doc": "ut-run doc"
    },
    "devDependencies": {
        "json-schema-to-markdown": "1.1.1",
        "ut-run": "10.17.0"
    }
}
```

### Examples

Look in the [doc/examples](./doc/examples) folder for more examples.
