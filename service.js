const utport = require('ut-port');
const path = require('path');

module.exports = ({bus, logFactory, log}) => {
    // let ready = () => {
    //     this.config = this.config || {};
    //     if (this.bus) {
    //         return this.bus.register({
    //             run: this.run.bind(this)
    //         });
    //     }
    // };

    let watch = (filename, fn) => {
        let cwd = path.dirname(filename);
        let fsWatcher = require('chokidar').watch('.', {
            cwd,
            ignoreInitial: true,
            ignored: ['.git/**', 'node_modules/**']
        });
        fsWatcher.on('error', error => log && log.error && log.error(error));
        fsWatcher.on('all', (event, file) => {
            log && log.info && log.info({
                $meta: {mtid: 'event', opcode: 'servicePartial.hotReload'},
                event,
                file: path.join(cwd, file)
            });
            // fsWatcher.close();
            fn();
        });
    };

    let servicePorts = utport.ports({bus: bus.publicApi, logFactory});

    function configure(obj = {}, config, moduleName) {
        return [].concat(...Object.entries(obj).map(([name, value]) => {
            if (value instanceof Function) {
                let propConfig = (config || {})[value.name || name];
                let startTime = process.hrtime();
                try {
                    value = propConfig && value(propConfig);
                } finally {
                    let endTime = process.hrtime(startTime);
                    propConfig && log && log.debug && log.debug({
                        $meta: {mtid: 'event', opcode: 'servicePartial.load'},
                        module: moduleName + '.' + (value.name || name),
                        loadTime: endTime[0] + '.' + (endTime[1] + '').substr(0, 3)
                    });
                }
            }
            return value;
        })).filter(value => value).map(create => ({create, moduleName}));
    };

    let loadModule = (utModule, config, test) => {
        let clearCache = filename => {
            let dir = path.dirname(filename);
            Object.keys(require.cache).filter(key => path.dirname(key) === dir).forEach(key => { delete require.cache[key]; });
        };

        function hotReload(filename, ...params) {
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
            prev.push(...loadModule(utModule, config, test));
            return prev;
        }, []);

        bus.config = config || {};
        return servicePorts.create(utModules, config || {}, test);
    };

    let create = (serviceConfig, config, test) => {
        if (typeof serviceConfig === 'function') {
            return (async() => load(await serviceConfig({config, bus: bus.publicApi}), config, test))();
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
