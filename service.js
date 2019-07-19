const hrtime = require('browser-process-hrtime');
const utport = require('ut-port');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const readConfig = filename => {
    const content = fs
        .readFileSync(filename)
        .toString('utf8')
        .trim()
        .replace(/\r\n/g, '\n');
    return {
        content: content,
        // https://github.com/kubernetes/kubernetes/blob/release-1.15/staging/src/k8s.io/cli-runtime/pkg/kustomize/k8sdeps/transformer/hash/hash.go#L123
        hash: crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substr(0, 10)
            .split('')
            .map(x => ({'0': 'g', '1': 'h', '3': 'k', a: 'm', 'e': 't'}[x] || x))
            .join('')
    };
};

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
                $meta: {mtid: 'event', opcode: 'serviceLayer.hotReload'},
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
                        $meta: {mtid: 'event', opcode: 'serviceLayer.load'},
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

    const kustomize = ({filter, layers, config}) => {
        const portsAndModules = servicePorts.fetch(filter);
        const configFile = readConfig(config.config);
        const namespace = {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: config.implementation + '-' + config.params.env
            }
        };
        const result = portsAndModules.reduce((prev, portOrModule) => {
            const layer = portOrModule.config.pkg.layer;
            const ports = (portOrModule.config.k8s && portOrModule.config.k8s.ports) || [];
            const containerPorts = ports.map(port => ({
                name: port.name,
                protocol: port.protocol || 'TCP',
                containerPort: port.containerPort
            }));
            const deploymentNames = (layers[layer] || '').split(',').filter(x => x);
            if (deploymentNames.length) {
                deploymentNames.forEach(deploymentName => {
                    const deployment = prev.deployments[deploymentName] || {
                        apiVersion: 'apps/v1',
                        kind: 'Deployment',
                        metadata: {
                            namespace: namespace.metadata.name,
                            name: deploymentName,
                            labels: {
                                'app.kubernetes.io/name': deploymentName,
                                'app.kubernetes.io/version': config.version,
                                'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                'app.kubernetes.io/part-of': config.implementation,
                                'app.kubernetes.io/managed-by': 'ut-run'
                            }
                        },
                        spec: {
                            replicas: 1,
                            selector: {
                                matchLabels: {
                                    'app.kubernetes.io/name': deploymentName,
                                    'app.kubernetes.io/version': config.version,
                                    'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                    'app.kubernetes.io/part-of': config.implementation,
                                    'app.kubernetes.io/managed-by': 'ut-run'
                                }
                            },
                            template: {
                                metadata: {
                                    annotations: {
                                        'sidecar.istio.io/inject': 'true'
                                    },
                                    labels: {
                                        'app.kubernetes.io/name': deploymentName,
                                        'app.kubernetes.io/version': config.version,
                                        'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                        'app.kubernetes.io/part-of': config.implementation,
                                        'app.kubernetes.io/managed-by': 'ut-run'
                                    }
                                },
                                spec: {
                                    volumes: [{
                                        name: 'rc',
                                        secret: {
                                            secretName: prev.secrets.rc.metadata.name
                                        }
                                    }, config.run.minikube && {
                                        name: 'ut',
                                        hostPath: {
                                            path: '/ut/impl'
                                        }
                                    }].filter(x => x),
                                    imagePullSecrets: [{
                                        name: 'docker'
                                    }],
                                    containers: [{
                                        name: 'ut',
                                        image: 'softwaregroup/impl-' + config.implementation + ':' + config.version,
                                        imagePullPolicy: 'IfNotPresent',
                                        args: [
                                            config.params.app,
                                            '--run.hotReload=0',
                                            deploymentName === 'console'
                                                ? '--utLog.streams.udp=0'
                                                : '--utLog.streams.udp.streamConfig.host=utportconsole-udp-log',
                                            '--utBus.serviceBus.jsonrpc.port=8090',
                                            '--utBus.serviceBus.jsonrpc.domain=0',
                                            '--service=' + deploymentName
                                        ],
                                        env: [{
                                            name: 'UT_ENV',
                                            value: config.params.env
                                        }],
                                        ports: [{
                                            name: 'http-jsonrpc',
                                            protocol: 'TCP',
                                            containerPort: 8090
                                        }],
                                        livenessProbe: {
                                            initialDelaySeconds: 60,
                                            httpGet: {
                                                path: '/healthz',
                                                port: 'http-jsonrpc'
                                            }
                                        },
                                        readinessProbe: {
                                            initialDelaySeconds: 60,
                                            httpGet: {
                                                path: '/healthz',
                                                port: 'http-jsonrpc'
                                            }
                                        },
                                        volumeMounts: [{
                                            name: 'rc',
                                            mountPath: ('/etc/ut_' + config.implementation.replace(/[-/\\]/g, '_') + '_' + config.params.env).toLowerCase()
                                        }, config.run.minikube && {
                                            name: 'ut',
                                            mountPath: '/ut/impl'
                                        }].filter(x => x),
                                        resources: {
                                            limits: {
                                                memory: '250M',
                                                cpu: '0.20'
                                            },
                                            requests: {
                                                memory: '100M',
                                                cpu: '0.20'
                                            }
                                        }
                                    }]
                                }
                            }
                        }
                    };
                    const args = deployment.spec.template.spec.containers[0].args;
                    if (!args.includes('--' + layer)) args.push('--' + layer);
                    deployment.spec.template.spec.containers[0].ports.push(...containerPorts);
                    prev.deployments[deploymentName] = deployment;
                });
                const addService = ({name, port, targetPort, protocol = 'TCP', clusterIP}) => {
                    if (prev.services[name.toLowerCase()]) {
                        const existing = prev.services[name.toLowerCase()].metadata.labels['app.kubernetes.io/name'];
                        const error = new Error(`Dublication of service ${name} in ${existing} and ${portOrModule.config.pkg.layer}`);
                        prev.errors.push(error);
                        log && log.error && log.error(error);
                    } else {
                        prev.services[name.toLowerCase()] = {
                            apiVersion: 'v1',
                            kind: 'Service',
                            metadata: {
                                namespace: namespace.metadata.name,
                                name: name.toLowerCase(),
                                labels: {
                                    'app.kubernetes.io/name': portOrModule.config.pkg.layer,
                                    'app.kubernetes.io/component': portOrModule.config.pkg.name,
                                    'app.kubernetes.io/version': portOrModule.config.pkg.version,
                                    'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                    'app.kubernetes.io/part-of': config.implementation,
                                    'app.kubernetes.io/managed-by': 'ut-run'
                                }
                            },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{
                                    port,
                                    targetPort,
                                    protocol,
                                    name: targetPort
                                }],
                                selector: {
                                    'app.kubernetes.io/name': deploymentNames[0],
                                    'app.kubernetes.io/version': config.version,
                                    'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                    'app.kubernetes.io/part-of': config.implementation,
                                    'app.kubernetes.io/managed-by': 'ut-run'
                                },
                                ...clusterIP && {clusterIP}
                            }
                        };
                    }
                };
                const addIngress = ({path, host, name, servicePort, serviceName}) => {
                    prev.ingresses[name] = {
                        apiVersion: 'extensions/v1beta1',
                        kind: 'Ingress',
                        metadata: {
                            namespace: namespace.metadata.name,
                            name
                        },
                        spec: {
                            rules: [{
                                ...host && {host},
                                http: {
                                    paths: [{
                                        ...path && {path},
                                        backend: {
                                            serviceName: serviceName.toLowerCase(),
                                            servicePort
                                        }
                                    }]
                                }

                            }]
                        }
                    };
                };
                if (deploymentNames.length === 1) {
                    [].concat(portOrModule.config.namespace).forEach(ns => ns && addService({
                        name: ns.replace(/\//g, '-') + '-service',
                        port: 8090,
                        targetPort: 'http-jsonrpc'
                    }));
                    ports.forEach(port => port.service && addService({
                        name: portOrModule.config.id.replace(/\./g, '-') + '-' + port.name,
                        port: port.containerPort,
                        protocol: port.protocol,
                        targetPort: port.name,
                        ...port.service
                    }));
                    ports.forEach(port => port.ingress && addIngress({
                        name: deploymentNames[0] + '-' + port.name,
                        serviceName: portOrModule.config.id.replace(/\./g, '-') + '-' + port.name,
                        servicePort: port.name,
                        ...port.ingress
                    }));
                }
            };
            return prev;
        }, {
            namespace,
            secrets: {
                rc: {
                    apiVersion: 'v1',
                    kind: 'Secret',
                    metadata: {
                        namespace: namespace.metadata.name,
                        name: 'rc-' + configFile.hash
                    },
                    type: 'Opaque',
                    stringData: {
                        config: configFile.content
                    }
                }
            },
            services: {},
            deployments: {},
            ingresses: {},
            errors: []
        });
        return result;
    };

    serviceBus.registerLocal({
        service: {
            create,
            start
        }
    }, 'ut');

    return {create, start, kustomize};
};
