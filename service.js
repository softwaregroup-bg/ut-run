var when = require('when');
var merge = require('lodash.merge');

module.exports = ({bus, logFactory}) => {
    // let ready = () => {
    //     this.config = this.config || {};
    //     if (this.bus) {
    //         return this.bus.register({
    //             run: this.run.bind(this)
    //         });
    //     }
    // };

    let servicePorts = new Map();

    let load = (implementation, config, test) => {
        if (typeof implementation === 'string') {
            implementation = require(implementation);
        }

        if (Array.isArray(implementation)) {
            implementation = implementation.reduce((prev, impl) => {
                if (impl) {
                    if (impl instanceof Function) {
                        impl = impl(config);
                    }
                    impl.ports && (prev.ports = prev.ports.concat(impl.ports));
                    impl.modules && Object.assign(prev.modules, impl.modules);
                    impl.validations && Object.assign(prev.validations, impl.validations);
                }
                return prev;
            }, {ports: [], modules: {}, validations: {}});
        }
        config = config || {};
        var ports = [];
        if (config.registry) {
            ports.push({
                id: 'registry',
                createPort: require('ut-port-registry'),
                context: {
                    version: config.version,
                    impl: config.implementation
                }
            });
        }
        if (Array.isArray(implementation.ports)) {
            ports.push.apply(ports, implementation.ports);
        }
        var portsStarted = [];
        bus.config = config;

        if (implementation.modules instanceof Object) {
            Object.keys(implementation.modules).forEach(function(moduleName) {
                var module = implementation.modules[moduleName];
                if (module) {
                    if (module instanceof Function) {
                        module = module(config);
                    }
                    (module.init instanceof Function) && (module.init(bus));
                    module.routeConfig = [];
                    bus.registerLocal(module, moduleName);
                }
            });
        }

        if (implementation.validations instanceof Object) {
            Object.keys(implementation.validations).forEach(function(validationKey) {
                var routeConfig = implementation.validations[validationKey];
                if (routeConfig) {
                    if (routeConfig instanceof Function) {
                        routeConfig = routeConfig(config);
                    }
                    var routeConfigNames = validationKey.split('.');
                    var moduleName = routeConfigNames.length > 1 ? routeConfigNames.shift() : routeConfigNames;
                    var module = implementation.modules[moduleName];
                    module && Object.keys(routeConfig).forEach(function(value) {
                        module.routeConfig.push({
                            method: routeConfigNames.join('.') + '.' + value,
                            config: routeConfig[value]
                        });
                    });
                }
            });
        }

        return when.all(
            ports.reduce(function(all, port) {
                if (port) {
                    if (port instanceof Function) {
                        port = port(config);
                    }
                    config[port.id] !== false && all.push(initPort(merge(port, config[port.id])));
                }
                return all;
            }, [])
        ).then(function(contexts) {
            return when.reduce(contexts, function(prev, context, idx) {
                portsStarted.push(context); // collect ports that are started
                var started = context.start();
                if (test && started && typeof started.then === 'function') {
                    return started.then(result => {
                        test.ok(true, 'started port ' + context.config.id);
                        return result;
                    });
                } else {
                    return started;
                }
            }, [])
            .then(function() {
                return portsStarted
                    .reduce(function(promise, port) {
                        if (typeof port.ready === 'function') {
                            promise = promise.then(() => port.ready());
                        }
                        return promise;
                    }, Promise.resolve())
                    .then(() => contexts);
            })
            .catch(function(err) {
                return when.reduce(portsStarted.reverse(), function(prev, context, idx) {
                    return new Promise((resolve) => resolve(context.stop())).catch(() => true); // continue on error
                }, [])
                .then(() => Promise.reject(err)); // reject with the original error
            });
        });
    };

    let loadImpl = (implementation, config, test) => {
        if (typeof implementation === 'function') {
            return new Promise(resolve => resolve(implementation({config})))
                .then(result => load(result, config, test));
        } else {
            return load(implementation, config, test);
        }
    };

    let initPort = (config) => {
        var Port;
        if (config.createPort instanceof Function) {
            Port = config.createPort;
        } else {
            if (config.type) {
                throw new Error('Use createPort:require(\'ut-port-' + config.type + '\') instead of type:\'' + config.type + '\'');
            } else {
                throw new Error('Missing createPort property');
            }
        }
        var port = new Port();
        port.bus = bus;
        port.logFactory = logFactory;
        merge(port.config, config);
        return when(port.init()).then(function() {
            config.id && servicePorts.set(config.id, port);
            return port;
        });
    };

    let port = {
        get: ({port}) => servicePorts.get(port),
        fetch: () => Array.from(servicePorts.values()),
        init: initPort,
        start: ({port}) => {
            port = servicePorts.get(port);
            return port && Promise.resolve()
                .then(() => port.start())
                .then(() => port.ready())
                .then(() => port);
        },
        stop: ({port}) => {
            port = servicePorts.get(port);
            return port && Promise.resolve()
                .then(() => port.stop())
                .then(() => port);
        },
        move: ({port, x, y}) => {
            port = servicePorts.get(port);
            if (port) {
                port.config.x = x;
                port.config.y = y;
            }
            return port;
        }
    };

    let impl = {
        load: loadImpl
    };

    let api = {
        impl,
        port
    };

    bus.registerLocal(api, 'run');

    return api;
};
