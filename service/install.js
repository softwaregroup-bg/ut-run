const crypto = require('crypto');
const fs = require('fs');
const yaml = require('yaml');
const merge = require('ut-function.merge');
const fluentbit = require('./fluentbit');

const hash = content => crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substr(0, 10)
    .split('')
    .map(x => ({'0': 'g', '1': 'h', '3': 'k', a: 'm', 'e': 't'}[x] || x))
    .join('');

const readConfig = filename => {
    const content = fs
        .readFileSync(filename)
        .toString('utf8')
        .trim()
        .replace(/\r\n/g, '\n');
    return {
        content: content,
        // https://github.com/kubernetes/kubernetes/blob/release-1.15/staging/src/k8s.io/cli-runtime/pkg/kustomize/k8sdeps/transformer/hash/hash.go#L123
        hash: hash(content)
    };
};

module.exports = ({portsAndModules, log, layers, config, secret}) => {
    if (secret) {
        secret = yaml.stringify(merge(secret, {
            run: {
                hotReload: false
            },
            utBus: {
                serviceBus: {
                    jsonrpc: {
                        metrics: true,
                        port: 8090,
                        domain: false
                    }
                }
            },
            utLog: {
                streams: {
                    udp: {
                        streamConfig: {
                            host: 'utportconsole-udp-log'
                        }
                    },
                    fluentbit: config.k8s.fluentbit && {
                        level: 'trace',
                        stream: '../fluentdStream',
                        streamConfig: {
                            host: 'fluent-bit',
                            port: 24224
                        },
                        type: 'raw'
                    }
                }
            }
        }));
    }
    const configFile = secret ? {
        content: secret,
        hash: hash(secret)
    } : readConfig(config.config);
    const namespace = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: config.k8s.namespace || (config.implementation + '-' + config.params.env),
            labels: {
                'istio-injection': 'enabled'
            }
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
                                    'sidecar.istio.io/inject': 'true',
                                    'prometheus.io/scrape': 'true',
                                    'prometheus.io/port': '8090',
                                    'prometheus.io/scheme': 'http'
                                },
                                labels: {
                                    'app': deploymentName,
                                    'version': config.version,
                                    'app.kubernetes.io/name': deploymentName,
                                    'app.kubernetes.io/version': config.version,
                                    'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                                    'app.kubernetes.io/part-of': config.implementation,
                                    'app.kubernetes.io/managed-by': 'ut-run'
                                }
                            },
                            spec: {
                                ...(config.k8s.node || config.k8s.architecture) && {
                                    nodeSelector: {
                                        ...config.k8s.node && {'kubernetes.io/hostname': config.k8s.node},
                                        ...config.k8s.architecture && {'kubernetes.io/arch': config.k8s.architecture}
                                    }
                                },
                                volumes: [{
                                    name: 'rc',
                                    secret: {
                                        secretName: prev.secrets.rc.metadata.name
                                    }
                                }, config.k8s && config.k8s.minikube && {
                                    name: 'ut',
                                    hostPath: {
                                        path: '/ut/impl'
                                    }
                                }].filter(x => x),
                                imagePullSecrets: config.k8s.username && config.k8s.password && [{
                                    name: 'docker'
                                }],
                                containers: [{
                                    name: 'ut',
                                    image: (config.k8s.repository ? config.k8s.repository + '/' : '') + (config.k8s.image || ('ut/impl-' + config.implementation + ':' + config.version)),
                                    imagePullPolicy: config.k8s.pull || undefined,
                                    args: [
                                        config.params.app,
                                        '--service=' + deploymentName,
                                        (deploymentName === 'console') && '--utLog.streams.udp=0'
                                    ].filter(x => x),
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
                                    }, config.k8s && config.k8s.minikube && {
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
                                            cpu: '0.10'
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
            },
            docker: config.k8s.username && config.k8s.password && {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: {
                    namespace: namespace.metadata.name,
                    name: 'docker'
                },
                type: 'kubernetes.io/dockerconfigjson',
                data: {
                    '.dockerconfigjson': Buffer.from(JSON.stringify({
                        auths: {
                            [config.k8s.repository]: {auth: Buffer.from(`${config.k8s.username}:${config.k8s.password}`).toString('base64')}
                        }
                    })).toString('base64')
                }
            }
        },
        services: {
            fluentbit: config.k8s.fluentbit && fluentbit({namespace: namespace.metadata.name, ...config.k8s.fluentbit}).service
        },
        deployments: {
            fluentbit: config.k8s.fluentbit && fluentbit({namespace: namespace.metadata.name, ...config.k8s.fluentbit}).deployment
        },
        ingresses: {},
        errors: []
    });
    return result;
};
