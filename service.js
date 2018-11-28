var utport = require('ut-port');

module.exports = ({bus, logFactory, log}) => {
    // let ready = () => {
    //     this.config = this.config || {};
    //     if (this.bus) {
    //         return this.bus.register({
    //             run: this.run.bind(this)
    //         });
    //     }
    // };

    let servicePorts = utport.ports({bus: bus.publicApi, logFactory});
    let iterable = value => Array.isArray(value) || Object.values(value).find(value => value instanceof Function);

    let load = (utModules, config, test) => {
        if (typeof utModules === 'string') {
            utModules = require(utModules);
        }

        if (iterable(utModules)) {
            utModules = Object.values(utModules).reduce((prev, utModule) => {
                let moduleConfig;
                let moduleName;
                if (utModule instanceof Function) {
                    if (utModule.name) {
                        moduleConfig = config[utModule.name];
                        moduleName = utModule.name;
                        utModule = moduleConfig && utModule(moduleConfig);
                    } else {
                        moduleName = '';
                        moduleConfig = config;
                        utModule = utModule(moduleConfig);
                    }
                }
                let configure = obj => {
                    let result = obj instanceof Array ? [] : {};
                    Object.keys(obj).forEach(name => {
                        let value = obj[name];
                        if (value instanceof Function) {
                            let propConfig = (moduleConfig || {})[value.name || name];
                            if (propConfig) {
                                log && log.debug && log.debug({
                                    $meta: {mtid: 'event', opcode: 'service.load'},
                                    module: moduleName + '.' + (value.name || name)
                                });
                            }
                            value = propConfig && value(propConfig);
                        }
                        result[name] = value;
                    });
                    return result;
                };
                if (utModule instanceof Function) utModule = [utModule]; // returned only one service
                utModule && Object.values(configure(utModule)).forEach((utService) => {
                    if (utService) {
                        utService.ports && (prev.ports = prev.ports.concat(utService.ports));
                        utService.errors && (prev.errors = prev.errors.concat(utService.errors));
                        utService.modules && Object.assign(prev.modules, configure(utService.modules));
                        utService.validations && Object.assign(prev.validations, configure(utService.validations));
                        Array.isArray(utService) && prev.any.push(...utService.map(create => ({
                            create,
                            moduleName
                        })).filter(item => item));
                    }
                });
                return prev;
            }, {ports: [], modules: {}, validations: {}, errors: [], any: []});
        }
        config = config || {};

        bus.config = config;

        if (Array.isArray(utModules.errors)) {
            utModules.errors.forEach(errorFactory => {
                if (errorFactory instanceof Function) {
                    errorFactory(bus.errors);
                }
            });
        }

        let modules = {};
        if (utModules.modules instanceof Object) {
            Object.keys(utModules.modules).forEach(function(moduleName) {
                var mod = utModules.modules[moduleName];
                if (mod) {
                    (mod.init instanceof Function) && (mod.init(bus.publicApi));
                    mod.routeConfig = [];
                    bus.registerLocal(mod, moduleName);
                    modules[moduleName] = mod;
                }
            });
        }

        if (utModules.validations instanceof Object) {
            Object.keys(utModules.validations).forEach(function(validationKey) {
                var routeConfig = utModules.validations[validationKey];
                if (routeConfig) {
                    var routeConfigNames = validationKey.split('.');
                    var moduleName = routeConfigNames[0];
                    var mod = modules[moduleName];
                    if (!mod) {
                        mod = {routeConfig: []};
                        bus.registerLocal(mod, moduleName);
                        modules[moduleName] = mod;
                    }
                    mod && Object.keys(routeConfig).forEach(function(value) {
                        mod.routeConfig.push({
                            method: routeConfigNames.join('.') + '.' + value,
                            config: routeConfig[value]
                        });
                    });
                }
            });
        }

        return servicePorts.create(utModules.ports, utModules.any, config, test);
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
