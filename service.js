const hrtime = require('browser-process-hrtime');
const utport = require('ut-port');
const path = require('path');

module.exports = ({serviceBus, logFactory, log}) => {
    let watch = (filename, fn) => {
        let cwd = path.dirname(filename);
        let fsWatcher = require('chokidar').watch('**/*.js', {
            cwd,
            ignoreInitial: true,
            ignored: ['.git/**', 'node_modules/**', 'ui/**']
        });
        fsWatcher.on('error', error => log && log.error && log.error(error));
        fsWatcher.on('all', (event, file) => {
            log && log.info && log.info({
                $meta: {mtid: 'event', opcode: 'serviceLayer.hotReload'},
                event,
                file: path.join(cwd, file)
            });
            // fsWatcher.close();
            fn();
        });
    };

    let servicePorts = utport.ports({bus: serviceBus.publicApi, logFactory});

    function configure(obj = {}, config, moduleName) {
        return [].concat(...Object.entries(obj).map(([name, value]) => {
            if (value instanceof Function) {
                let serviceName = value.name || name;
                let propConfig = (config || {})[serviceName];
                let startTime = hrtime();
                try {
                    value = propConfig && value(propConfig);
                } finally {
                    let endTime = hrtime(startTime);
                    propConfig && log && log.debug && log.debug({
                        $meta: {mtid: 'event', opcode: 'serviceLayer.load'},
                        module: moduleName + '.' + serviceName,
                        loadTime: endTime[0] + '.' + (endTime[1] + '').substr(0, 3)
                    });
                }
            }
            return value;
        })).filter(value => value).map(create => ({create, moduleName}));
    };

    let loadModule = (utModule, config, test) => {
        if (!utModule) return;
        let clearCache = filename => {
            let dir = path.dirname(filename);
            Object.keys(require.cache).filter(key => {
                const relative = path.relative(dir, key);
                return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
            }).forEach(key => { delete require.cache[key]; });
        };

        function hotReload(filename, ...params) {
            if (!filename) return;
            config && config.run && config.run.hotReload && watch(filename, async() => {
                clearCache(filename);
                let utModule = require(filename)(...params);
                await servicePorts.destroy(utModule.name);
                return servicePorts.start(await load([utModule], config, test));
            });

            return require(filename)(...params);
        };

        let moduleConfig;
        let moduleName;
        if (typeof utModule === 'string') utModule = [utModule];
        if (Array.isArray(utModule)) utModule = hotReload(...utModule);
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
        return configure(utModule, moduleConfig, moduleName);
    };

    let load = (utModules, config, test) => {
        utModules = utModules.reduce((prev, utModule) => {
            let loaded = loadModule(utModule, config, test);
            if (loaded) prev.push(...loaded);
            return prev;
        }, []);

        serviceBus.config = config || {};
        return servicePorts.create(utModules, config || {}, test);
    };

    let create = (serviceConfig, config, test) => {
        if (typeof serviceConfig === 'function') {
            return (async() => load(await serviceConfig({config, bus: serviceBus.publicApi}), config, test))();
        } else {
            return load(serviceConfig, config, test);
        }
    };

    let start = ports => servicePorts.start(ports);

    serviceBus.registerLocal({
        service: {
            create,
            start
        }
    }, 'ut');

    return {create, start};
};
