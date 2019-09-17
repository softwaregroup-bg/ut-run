const hrtime = require('browser-process-hrtime');
const utport = require('ut-port');
const path = require('path');

module.exports = ({serviceBus, logFactory, log}) => {
    const watch = (filename, fn) => {
        const cwd = path.dirname(filename);
        const fsWatcher = require('chokidar').watch('**/*.js', {
            cwd,
            ignoreInitial: true,
            ignored: ['.git/**', 'node_modules/**', 'ui/**']
        });
        fsWatcher.on('error', error => log && log.error && log.error(error));
        fsWatcher.on('all', (event, file) => {
            log && log.info && log.info({
                $meta: {mtid: 'event', method: 'serviceLayer.hotReload'},
                event,
                file: path.join(cwd, file)
            });
            // fsWatcher.close();
            fn();
        });
    };

    const servicePorts = utport.ports({bus: serviceBus.publicApi, logFactory});

    function configure(obj = {}, config, moduleName, pkg) {
        return [].concat(...Object.entries(obj).map(([name, value]) => {
            let layer;
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
                moduleName = utModule.name;
                utModule = moduleConfig && utModule({config: moduleConfig});
            } else {
                moduleName = '';
                moduleConfig = config;
                utModule = utModule(moduleConfig);
            }
        }
        if (utModule instanceof Function) utModule = [utModule]; // returned only one service
        return configure(utModule, moduleConfig, moduleName, pkg);
    };

    const loadModule = (utModule, config, test) => {
        if (!utModule) return;
        const clearCache = filename => {
            const dir = path.dirname(filename);
            Object.keys(require.cache).filter(key => {
                const relative = path.relative(dir, key);
                return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
            }).forEach(key => { delete require.cache[key]; });
        };

        function hotReload(filenames, ...params) {
            const {main, pkg} = typeof filenames === 'string' ? {main: filenames} : filenames;
            function requireWithMeta() {
                const result = require(main)(...params);
                let pkgJson = pkg && require(pkg);
                if (pkgJson) {
                    pkgJson = {
                        name: pkgJson.name,
                        version: pkgJson.version
                    };
                }
                return [result, pkgJson];
            }

            if (!filenames) return [];
            config && config.run && config.run.hotReload && watch(main, async() => {
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

    const create = async(serviceConfig, config, test) => servicePorts.create(
        await load(serviceConfig, config, test),
        config || {},
        test
    );

    const start = ports => servicePorts.start(ports);

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
