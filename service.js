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
        if (Array.isArray(serviceConfig.ports)) {
            ports.push.apply(ports, serviceConfig.ports);
        }

        bus.config = config;

        if (serviceConfig.modules instanceof Object) {
            Object.keys(serviceConfig.modules).forEach(function(moduleName) {
                var module = serviceConfig.modules[moduleName];
                if (module) {
                    if (module instanceof Function) {
                        module = module(config);
                    }
                    (module.init instanceof Function) && (module.init(bus.publicApi));
                    module.routeConfig = [];
                    bus.registerLocal(module, moduleName);
                }
            });
        }

        if (serviceConfig.validations instanceof Object) {
            Object.keys(serviceConfig.validations).forEach(function(validationKey) {
                var routeConfig = serviceConfig.validations[validationKey];
                if (routeConfig) {
                    if (routeConfig instanceof Function) {
                        routeConfig = routeConfig(config);
                    }
                    var routeConfigNames = validationKey.split('.');
                    var moduleName = routeConfigNames.length > 1 ? routeConfigNames.shift() : routeConfigNames;
                    var module = serviceConfig.modules[moduleName];
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
