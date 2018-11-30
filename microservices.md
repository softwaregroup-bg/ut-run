# Microservices

UT Framework allows modular approach towards microservices development.
This approach helps for addressing the various aspects of the development
by providing common approach to the aspects described below

## Definitions

We will use the following definitions:

* `Microservice` - A buzzword, referring to the runtime aspect of a modular
  development of application server middleware, using service oriented
  architecture (SOA). In this framework, we are not targeting only
  server side middleware. The same principles can apply for a much bigger
  domain of software

* `Business logic` - the primary functionality of the system, which
  defines how it solves business's use cases

* `Data integrity logic` - part of the business logic, that ensures that
  data is persisted in an atomic and logically correct way.

* `Business process` / `workflow` - part of the business logic, that operates
  on top of the `data integrity logic` and coordinates it. Note that there is
  no strict boundary between the `business process` and the `data integrity logic`,
  but often the `data integrity logic` does not change between implementations,
  while the `business process` is more varying.

* `Microservice platform` - the platform that is going to run the software.
  Although primary focus will be `server`, same concepts can be applied for
  other platforms:
  * `desktop` - Desktop application
  * `browser` - Browser base application
  * `mobile` - Mobile application

* `Microservice modular approach` - allow microservices to be created by combining
  functionality of several modules, while keeping maximum isolation between them

* `Microservice module` - this is a grouping of `microservice partials`, as an
  individual development unit, often focused on full implementation of closely
  related functionality. Each microservice module is usually developed in a
  separate code repository and all partials are released and versioned together.
  Examples are:
  * `loan module` - a module for handling a Loan lifecycle
  * `transfer module` - a module for handling electronic funds transfers

* `Microservice partial` - this is partial functionality of certain microservice,
  usually relating to some architectural layers (like database, front-end, etc.)
  or functional aspect(like transaction processing, reporting, etc.).

  Examples partials are:
  * `gateway` - the part of functionality, relating to the API gateway.
    It includes functions relating to API documentation, validations,
    route handlers, etc. Usually it includess almost no `busines logic`

  * `adapter` - the part of the functionality, that implements functions related
  directly to communicating with external systems, often handling network protocols.
  This often relates directly with the `Data integrity logic`. Examples include
  handling communication with SQL, HTTP, FTP, mail and other servers or devices.

  * `orchestrator` - the part of the functionality, that coordinates the work
  between adapters. This is often where the `business process` is implemented
  * `eft` - the part of the `business process` that handles funds transfers.
  This is a typical example of online transaction processing (OLTP).
  This is usually where high requirements for scalability, transactions per
  second (TPS), security and resilience are required, so it deserves a
  separate partial.

  NOTE: the primary goal of `microservice partials` is to group different
  kinds of `microservice handlers`, that usually run in one microservice.
  By grouping them, it is easier to run them together.

* `Microservice handlers` - this is a set of low level functions, usually
  grouped by their role, for example: validations, error definitions,
  database schema, etc. These handlers are often named in the form
  `name1.name2.name3`, to allow for namesapcing between microservice modules.

## Logical structure

Following a common logical structure, allows combining the `microservice modules`,
`microservice partials` and `microservie handlers` in a flexible way,
so that different microservices may be created, depending on the need.
When combining these elements an important aspect is being able to
provide configuration and customization for each element, starting from
a simple enabling/disabling it, to passing more complex configuration.
Often parts of the configuration are specific to the running environment
(development, test, production, etc.). While ut-run can be used in defferent ways,
the following logical structure is its primary use case:

```js
// start definition of various handlers

// values param1, param2 will be taken from the module configuration,
// under a key named adapter1
function adapter1({utLog, utBus, utPort, utError, utMethod, config: {param1, param2}}) {

    // optionally create some closures to store private data
    let someMethod = utMethod('module2.entity1.action1');

    // return a class, which extends a base adapter (usually ut-port-*)
    // always pass all arguments, so each adapter has access to the same
    return class adapter1 extends require('ut-port-tcp')(...arguments) {

        // optionally override the constructor
        constructor({utLog, utBus, utPort, utError, utMethod, config}) {
            super(...arguments); // call super constructor with all arguments
            // init some fields
            this.field1 = {};
            this.field2 = 0;
        }

        // define getter, to override the base class defaults
        // final configuration will be a result of merging all defaults
        // in the class chain starting with the base class
        get defaults() {
            return {
                imports: ['utModule1.handlers1'], // add these as additional handlers
                idleSend: 60000, // generate idleSend event
                idleReceive: 130000, // generate idleSend event
                maxReceiveBuffer: 4096 // limit comms receive buffer
            };
        }

        // optionally override base class methods, do not forget to call super
        async start() {
            const result = await super.start(); // use await for better stack traces
            await someMethod(); // do some custom processing, using the closure
            return result;
        }
        stop() {
            // do custom processing
            return super.stop(); // no need of async/await, if we just return
        }

        // a set of event handlers, closely related to the adapter lifecycle
        handlers() {
            return {
                // use arrow function in case you need tho access the port with this
                // handle standard adapter events, no need to call super
                start: () => {},
                init: () => {},
                ready: () => {},
                stop: () => {},

                // optionally handle specific events for tcp port

                // event for when port was connected
                'connected.event.receive'() {},
                // event for when port was disconnected
                'disconnected.event.receive'() {},
                // event for port was sending no data for a while
                'idleSend.event.receive'(msg, $meta, context) {},
                // event for when port send queue is was empty for a while
                'drainSend.event.receive'(msg, $meta, context) {},

                // optionally handle method events, related to the protocol conversions
                // do not use arrow functions and avoid using this, to stay more
                // independent of the port and maybe move these methods
                // in a handlers lib, that is easier to unit test

                // before sending a request of type action1 to external system
                'action1.request.send'(msg, $meta) {},

                // after receiving a request of type action1 from external system
                'action1.request.receive'(msg, $meta) {},

                // before sending a response of type action1 to external system
                'action1.response.send'(msg, $meta) {},

                // after receiving a response of type action1 to external system
                'action1.response.receive'(msg, $meta) {}
            };
        }
    };
}

// define a set of handlers, to be imported in some adapter using imports: [utModule1.handlers1]
function handlers1({utMethod}) {
    // use utMethod to obtain local or remote methods
    const [module2Entity1Action1, invalidAmount] = ['module2.entity1.action1', 'module2.error1'].map(utMethod);
    return {
        async 'module1.entity1.action1'(msg, {forward}) { // use async function, for improved stack traces with await
            // call method, pass tracing data in $meta.forward
            let result = await module2Entity1Action1(msg, {forward});

            // throw predefined error, pass params
            if (result.amount <= 0) throw invalidAmount({params: {amount: result.amount}});
            return msg;
        },
        'module1.entity1.action2'(msg, $meta) {}
    };
}

// define handlers for creating custom errors
function error({utError}) {
    return {
        'module1.error1': utError.defineError('error1', 'module1', 'Error message1'),
        'module1.error2': utError.defineError('error2', 'module1', 'Error message2')
    }; // use utError to help define this structure
}
function sql() { // use 'sql' as function name, to define SQL server schemas.
    // Import using imports:['utModule1.sql'] in a ut-port-sql
    return {
        schema: [{
            path: path.join(__dirname, 'sql', 'schema'),
            linkSP: true
        }]
    };
};

// use 'sqlSeed' as function name, to define SQL server seeds.
// import using imports:['utModule1.sqlSeed'] in a ut-port-sql and put them after *.sql in the list
function sqlSeed() {
    return {
        schema: [{
            path: path.join(__dirname, 'sql', 'seed'),
            linkSP: true
        }]
    };
};

function sqlStandard({config}) {
    // check if the utModule.sqlStandard configuration exists to determine if the seed should be executed
    return config && {
        schema: [{
            path: path.join(__dirname, 'sql', 'standard'),
            linkSP: true
        }]
    };
};

// use 'http' as function name, to define http handlers.
// import using imports:['utModule1.http'] or imports:[/\.http$/] in ut-port-httpserver
function http() {
    return {
        start() { // this handler will be invoked on http server start
            this.registerRequestHandler([{}]); // register some handlers
        }
    };
};

// use validations as function name, to namespace all validations
// import using imports:['utModule1.validation'] or imports:[/\.validation$/] in ut-port-httpserver
function validation() {
    return {
        'entity.action1': () => ({
            description: 'Description of entity.action1', // description to show in the documentation
            params: joi.object.keys({}), // validations for the method parameters
            result: joi.object.keys({}) // validations for the method result
        })
    };
}

// group handlers as partials, partials as modules and modules as implementation
function platform1(...platformApi) { // will receive some platform API for the platform named 'platform1'
    // extend platform API with some customizations
    let customization = require('./customization')(...platformApi);

    return [ // return list of modules, that define all the microservices

        // return a module named utModule1, will prefix handlers with this name
        (implementationApi) => (function utModule1({param1, param2}) {
            // param1, param2 are values from then current configuration, under utModule1.*
            // the functions returned by partials will receive configuration
            // from utModule1 subkeys corresponding to the partial name
            return {
                partial1: ({param1, param2}) =>
                //  param1, param2 are values from then current configuration, under utModule1.partial1.*
                    [ // return array of handlers for this partial
                        adapter1, handlers1, error
                    ],
                partial2: () => // define second partial
                    [
                        sql, sqlSeed, sqlStandard, http, validation
                    ]
            };
        }(...customization)), // pass the customization to the module

        // second microservice module
        (implementationApi) => (function({config: {param1, param2}}) {
            // return anonymous module (function without a name)
            // access param1, param2 keys in the current configuration root, when there is no module name
        }(...customization)) // pass the customization to the module

    ];
};

module.exports = platform1;
```

## Physical structure

## Runtime structure

Deployment of microservices often require running of tens or hundreds of them across
a network. Developers often need to run substantial amount of these services
in an isolated environment, while they do changes to multiple microservices.
Trying to have the same runtime architecture - i.e. running big amount of
separate processes, leads to significant need of computing resources, which
can slow down the development and increase the cost. The framework allows during
developing, all microservices to be run as a single process, which has great
impact on reducing resource needs. This is often good enough approach, for
substantial part of the functionality.

Even when deploying in a smaller organization, it may make sense to combine
microservices in a single process. The framework allows this to be done easily,
by just provindig through configuration what services to be run.