var utport = require('ut-port');

module.exports = ({bus, logFactory}) => {
    // let ready = () => {
    //     this.config = this.config || {};
    //     if (this.bus) {
    //         return this.bus.register({
    //             run: this.run.bind(this)
    //         });
    //     }
    // };

    let servicePorts = utport.ports({bus: bus.publicApi, logFactory});

    let load = (serviceConfig, config, test) => {
        if (typeof serviceConfig === 'string') {
            serviceConfig = require(serviceConfig);
        }

        if (Array.isArray(serviceConfig)) {
            serviceConfig = serviceConfig.reduce((prev, impl) => {
                let implConfig;
                if (impl instanceof Function) {
                    if (impl.name) {
                        implConfig = config[impl.name];
                        impl = implConfig !== false && implConfig !== 'false' && impl(implConfig);
                    } else {
                        impl = impl();
                    }
                }
                let configure = obj => {
                    Object.keys(obj).forEach(name => {
                        let value = obj[name];
                        if (value instanceof Function) {
                            let propConfig = (implConfig || {})[name];
                            obj[name] = propConfig !== false && propConfig !== 'false' && value(propConfig);
                        }
                    });
                    return obj;
                };
                if (impl) {
                    impl.ports && (prev.ports = prev.ports.concat(impl.ports));
                    impl.errors && (prev.errors = prev.errors.concat(impl.errors));
                    impl.modules && Object.assign(prev.modules, configure(impl.modules));
                    impl.validations && Object.assign(prev.validations, configure(impl.validations));
                }
                return prev;
            }, {ports: [], modules: {}, validations: {}, errors: []});
        }
        config = config || {};
        var ports = [];
        if (Array.isArray(serviceConfig.ports)) {
            ports.push.apply(ports, serviceConfig.ports);
        }

        bus.config = config;

        if (Array.isArray(serviceConfig.errors)) {
            serviceConfig.errors.forEach(errorFactory => {
                if (errorFactory instanceof Function) {
                    errorFactory(bus.errors);
                }
            });
        }

        let modules = {};
        if (serviceConfig.modules instanceof Object) {
            Object.keys(serviceConfig.modules).forEach(function(moduleName) {
                var module = serviceConfig.modules[moduleName];
                if (module) {
                    (module.init instanceof Function) && (module.init(bus.publicApi));
                    module.routeConfig = [];
                    bus.registerLocal(module, moduleName);
                    modules[moduleName] = module;
                }
            });
        }

        if (serviceConfig.validations instanceof Object) {
            Object.keys(serviceConfig.validations).forEach(function(validationKey) {
                var routeConfig = serviceConfig.validations[validationKey];
                if (routeConfig) {
                    var routeConfigNames = validationKey.split('.');
                    var moduleName = routeConfigNames[0];
                    var module = modules[moduleName];
                    module && Object.keys(routeConfig).forEach(function(value) {
                        module.routeConfig.push({
                            method: routeConfigNames.join('.') + '.' + value,
                            config: routeConfig[value]
                        });
                    });
                }
            });
        }

        return servicePorts.create(ports, config, test);
    };

    let create = (serviceConfig, config, test) => {
        if (typeof serviceConfig === 'function') {
            return new Promise(resolve => resolve(serviceConfig({config, bus: bus.publicApi})))
                .then(result => load(result, config, test));
        } else {
            return load(serviceConfig, config, test);
        }
    };

    let start = ports => servicePorts.start(ports);

    bus.registerLocal({
        service: {
            create,
            start
        }
    }, 'ut');

    return {create, start};
};
