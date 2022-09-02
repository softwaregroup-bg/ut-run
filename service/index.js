const hrtime = require('browser-process-hrtime');
const utport = require('ut-port');
const path = require('path');
const {version} = require('../package.json');
const gte = require('semver/functions/gte');
const joi = require('joi');
const merge = require('ut-function.merge');
const clone = require('lodash.clonedeep');

module.exports = ({serviceBus, logFactory, log, vfs}) => {
    const watch = (filename, fn) => {
        const cwd = path.dirname(filename);
        const fsWatcher = require('chokidar').watch(['**/*.js', '**/*.yaml', '**/*.sql', '**/*.html'], {
            cwd,
            ignoreInitial: true,
            ignored: ['.git/**', 'node_modules/**', 'ui/**', '.lint/**', 'dist/**']
        });
        fsWatcher.on('error', error => log && log.error && log.error(error));
        fsWatcher.on('all', async(event, file) => {
            log && log.info && log.info({
                $meta: {mtid: 'event', method: 'serviceLayer.hotReload'},
                event,
                file: path.join(cwd, file)
            });
            // fsWatcher.close();
            try {
                await fn();
            } catch (error) {
                log && log.error && log.error(error);
            }
        });
    };

    const servicePorts = utport.ports({bus: serviceBus.publicApi, logFactory, vfs, joi, version: wanted => gte(version, wanted)});

    function configure(obj = {}, config, moduleName, pkg) {
        return [].concat(...Object.entries(obj).map(([name, value]) => {
            let layer;
            if (name === 'config') return [];
            if (value instanceof Function) {
                const serviceName = value.name || name;
                const propConfig = (config || {})[serviceName];
                const startTime = hrtime();
                layer = moduleName ? moduleName + '.' + serviceName : serviceName;
                try {
                    value = propConfig && value(propConfig);
                } finally {
                    const endTime = hrtime(startTime);
                    propConfig && log && log.debug && log.debug({
                        $meta: {mtid: 'event', method: 'serviceLayer.load'},
                        layer,
                        ...pkg && {package: pkg.name, version: pkg.version},
                        loadTime: endTime[0] + '.' + (endTime[1] + '').substr(0, 3)
                    });
                }
            } else {
                layer = moduleName ? moduleName + '.' + name : name;
            }
            return []
                .concat(value)
                .filter(value => value)
                .map(create => ({create, moduleName, pkg: {...pkg, layer}}));
        }));
    };

    const invokeModule = (utModule, pkg, config) => {
        let moduleConfig;
        let moduleName;
        if (!utModule) return;
        if (utModule instanceof Function) {
            if (utModule.name) {
                moduleConfig = config[utModule.name];
                if (moduleConfig) moduleConfig = clone(moduleConfig === true ? {} : moduleConfig);
                moduleName = utModule.name;
                utModule = moduleConfig && utModule({config: moduleConfig});
            } else {
                moduleName = '';
                moduleConfig = clone(config);
                utModule = utModule(moduleConfig);
            }
        }
        if (utModule instanceof Function) utModule = [utModule]; // returned only one service

        if (utModule && utModule.config && (moduleConfig || {}).config !== false) {
            const defaults = (utModule.config instanceof Function) ? utModule.config(moduleConfig) : utModule.config;
            const resultItem = name => {
                const item = defaults[name];
                return (item instanceof Function) ? item.apply(defaults, [{joi}]) : item;
            };
            const configs = (config.configFilenames || []).map(resultItem).filter(Boolean);
            if (moduleConfig) configs.push(moduleConfig);
            moduleConfig = merge(moduleConfig, merge({}, ...configs));
            const validation = resultItem('validation');
            if (validation) {
                moduleConfig = joi.attempt(
                    moduleConfig,
                    validation,
                    `Module ${pkg ? pkg.name : moduleName} configuration validation failed: `,
                    {abortEarly: false}
                );
            }
            if (moduleName) config[moduleName] = moduleConfig; else merge(config, moduleConfig);
        }

        return configure(utModule, moduleConfig, moduleName, pkg);
    };

    const loadModule = (utModule, config, test) => {
        if (!utModule) return;
        const clearCache = filename => {
            const dir = path.dirname(filename);
            const cache = require('./serverRequire').cache;
            Object.keys(cache).filter(key => {
                const relative = path.relative(dir, key);
                return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
            }).forEach(key => { delete cache[key]; });
        };

        function hotReload(filenames, ...params) {
            const {main, pkg} = typeof filenames === 'string' ? {main: filenames} : filenames;
            function requireWithMeta() {
                const result = require('./serverRequire')(main)(...params);
                let pkgJson = pkg && require('./serverRequire')(pkg);
                if (pkgJson) {
                    pkgJson = {
                        name: pkgJson.name,
                        version: pkgJson.version
                    };
                }
                return [result, pkgJson];
            }

            if (!filenames) return [];
            !process.browser && !require('./serverRequire').utCompile && config && config.run && !config.run.stop && config.run.hotReload && watch(main, async() => {
                clearCache(main);
                [utModule, pkgJson] = requireWithMeta();
                await servicePorts.destroy(utModule.name);
                return servicePorts.start(await servicePorts.create(invokeModule(utModule, pkgJson, config), config, test));
            });

            return requireWithMeta();
        };

        if (typeof utModule === 'string') utModule = [utModule];
        let pkgJson;
        if (Array.isArray(utModule)) [utModule, pkgJson] = hotReload(...utModule);
        return invokeModule(utModule, pkgJson, config);
    };

    const init = async(serviceConfig, config, test) => {
        if (typeof serviceConfig === 'function') serviceConfig = await serviceConfig({config, bus: serviceBus.publicApi});
        serviceBus.config = config || {};
        return serviceConfig;
    };

    const load = async(serviceConfig, config, test) => (await init(serviceConfig, config, test)).reduce((prev, utModule) => {
        const loaded = loadModule(utModule, config, test);
        if (loaded) prev.push(...loaded);
        return prev;
    }, []);

    const create = async(serviceConfig, config, test) => {
        try {
            return await servicePorts.create(
                await load(serviceConfig, config, test),
                config || {},
                test
            );
        } catch (error) {
            if (!error.type) error.type = 'serviceLayer.create';
            if (!log || test) throw error;
            log.error && log.error(error);
            throw new Error('silent');
        }
    };

    const start = async ports => {
        try {
            return await servicePorts.start(ports);
        } catch (error) {
            if (!error.type) error.type = 'serviceLayer.start';
            if (!log) throw error;
            log.error && log.error(error);
            throw new Error('silent');
        }
    };

    const method = fn => ({filter, ...rest} = {}) => {
        const portsAndModules = servicePorts.fetch(filter);
        return fn({
            log,
            portsAndModules,
            ...rest
        });
    };

    const install = (...params) => method(require('./install'))(...params);
    const schema = (...params) => method(require('./schema'))(...params);

    serviceBus.registerLocal({
        service: {
            create,
            start
        }
    }, 'ut');

    return {create, start, install, schema};
};
