# Examples

These examples show what is the minimal way to run certain functionality.
Although real world cases are more complex, these examples
illustrate some quick ways to implement the functionality and
can help with prototyping some easy solutions.

## [Hello world](./hello.js)

Run a microservice, which listens on random HTTP port and exposes a single
handler `subject.object.predicate` to other UT microservices running on the
same host:

```js
const dispatch = require('ut-function.dispatch');
require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'subject.object.predicate': () => 'hello world'
            })
        ]
    }],
    config: {
        implementation: 'hello',
        utBus: {serviceBus: {jsonrpc: {domain: true}}}
    }
});
```

> Check [test.http](./test.http) for an example how to call the API.

## [Unit tests](./unit.js)

Run unit tests for the exposed method:

```js
const dispatch = require('ut-function.dispatch');
require('ut-run').run({
    main: dispatch({
        'subject.object.predicate': () => 'hello world'
    }),
    method: 'unit',
    config: {},
    params: {
        steps: [{
            method: 'subject.object.predicate',
            name: 'call subject.object.predicate',
            result: (result, assert) =>
                assert.equals(result, 'hello world', 'return hello world')
        }]
    }
});
```

## [Top level functions](./toplevel.js)

Run a microservice, which listens on random HTTP port and easily expose any
stateless function exported by any node module at top level. This is very
quick way to create mocks or prototypes. All the exposed functions will
be available in other microservices via importing them by name.

```js
const dispatch = require('ut-function.dispatch');
const {promisify} = require('util');

const exec = async => (...params) => {
    const [moduleName, fn] = params.pop().method.split('.', 2);
    const mod = require(moduleName);
    const result = mod && mod[fn];
    return typeof result === 'function'
        ? (async ? promisify(result) : result).apply(mod, params)
        : result;
};

require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'os.cpus': exec(),
                'process.resourceUsage': exec(),
                'dns.lookup': exec(true)
            })
        ]
    }],
    config: {
        implementation: 'api',
        utBus: {serviceBus: {jsonrpc: {domain: true}}}
    }
});
```

> Check [test.http](./test.http) for an example how to call the API.

## [API](./api.js)

Run a microservice, which listens on random HTTP port and exposes a single
method `subject.object.predicate` to external consumers.
The validation function defines the way the API is exposed:

```js
const dispatch = require('ut-function.dispatch');
const joi = require('joi');

require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'subject.object.predicate': () => 'hello world'
            })
        ],
        gateway: [
            function validation() {
                return {
                    'subject.object.predicate': () => ({
                        auth: false,
                        params: joi.object({}),
                        result: joi.string()
                    })
                };
            }
        ]
    }],
    config: {
        implementation: 'api',
        utBus: {serviceBus: {jsonrpc: {utLogin: false}}}
    }
});
```

> Check [test.http](./test.http) for an example how to call the API.

To see the API documentation, run it on a fixed port, and disable
the integration with `ut-login`:

```bash
node api.js \
  --utBus.serviceBus.jsonrpc.utLogin=false \
  --utBus.serviceBus.jsonrpc.port=8090
```

Then open [http://localhost:8090/api](http://localhost:8090/api) in a browser.

## [API Gateway](./gateway.js)

Run a microservice, which listens on random HTTP port and exposes a single
method `subject.object.predicate` to external consumers through API
gateway on port 8080. The module `ut-gateway` acts as a reverse proxy,
which exposes the paths passed in the configuration `apiGateway.api`.

```js
const dispatch = require('ut-function.dispatch');
const joi = require('joi');

require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'subject.object.predicate': () => 'hello world'
            })
        ],
        gateway: [
            function validation() {
                return {
                    'subject.object.predicate': () => ({
                        auth: false,
                        params: joi.object({}),
                        result: joi.string()
                    })
                };
            },
            require('ut-gateway')({namespace: 'apiGateway'})
        ]
    }],
    config: {
        implementation: 'api',
        utBus: {serviceBus: {jsonrpc: {domain: true}}},
        apiGateway: {
            discover: true,
            api: [
                '/oauth2-redirect.html',
                '/api/{path*}',
                '/rpc/subject/{path*}'
            ]
        }
    }
});
```

> Check [test.http](./test.http) for an example how to call the API.

To see the API documentation, run it like this to disable
the integration with `ut-login`:

```bash
node gateway.js --utBus.serviceBus.jsonrpc.utLogin=false
```
