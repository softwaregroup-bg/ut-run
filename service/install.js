const crypto = require('crypto');
const fs = require('fs');
const yaml = require('yaml');
const merge = require('ut-function.merge');
const fluentbit = require('./fluentbit');
const sortKeys = require('sort-keys');
const path = require('path');

const hash = content => crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substr(0, 10)
    .split('')
    .map(x => ({0: 'g', 1: 'h', 3: 'k', a: 'm', e: 't'}[x] || x))
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

module.exports = ({portsAndModules, log, layers, config, secret, kustomization}) => {
    const k8s = config.k8s || {};
    const image = (k8s.repository ? k8s.repository + '/' : '') + (k8s.image || ('ut/impl-' + config.implementation + ':' + config.version));
    const mountPath = ('/etc/ut_' + config.implementation.replace(/[-/\\]/g, '_') + '_' + config.params.env).toLowerCase();
    const commonLabels = {
        'app.kubernetes.io/part-of': config.implementation,
        'app.kubernetes.io/managed-by': 'ut-run'
    };
    const deploymentLabels = {
        version: config.version,
        'app.kubernetes.io/version': config.version,
        'app.kubernetes.io/instance': config.implementation + '_' + config.version
    };
    const commonAnnotations = {
        'sidecar.istio.io/inject': 'true',
        'prometheus.io/scrape': 'true',
        'prometheus.io/port': '8090',
        'prometheus.io/scheme': 'http'
    };
    const containerDefaults = {
        name: 'ut',
        ...k8s.pull && {imagePullPolicy: k8s.pull},
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
            name: 'config',
            mountPath
        }, k8s && k8s.minikube && {
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
    };
    if (secret) {
        secret = yaml.stringify(sortKeys(merge(secret, {
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
                    ...k8s.fluentbit && {
                        fluentbit: {
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
            }
        }), {deep: true}));
    }
    const configFile = secret ? {
        content: secret,
        hash: hash(secret)
    } : readConfig(config.config);
    const namespace = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: k8s.namespace || (config.implementation + '-' + config.params.env),
            labels: {
                'istio-injection': 'enabled'
            }
        }
    };
    const ingressConfig = k8s.ingress || {};
    const nodeSelector = (k8s.node || k8s.architecture) && {
        nodeSelector: {
            ...k8s.node && {'kubernetes.io/hostname': k8s.node},
            ...k8s.architecture && {'kubernetes.io/arch': k8s.architecture}
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
        const addIngress = ({path, host, name, servicePort, serviceName}) => {
            const ingressKey = `ingresses/${name}.yaml`;
            const ingress = prev.ingresses[ingressKey] || {
                apiVersion: 'networking.k8s.io/v1',
                kind: 'Ingress',
                metadata: {
                    ...!kustomization && {namespace: namespace.metadata.name},
                    name
                },
                spec: {}
            };
            if (host || path) {
                if (!ingress.spec.rules) ingress.spec.rules = [];
                const ingressRule = prev.ingressRules[name + '@' + (host || '')] || {
                    ...host && {host},
                    http: {
                        paths: []
                    }
                };
                if (!ingressRule.http.paths.length) ingress.spec.rules.push(ingressRule);
                ingressRule.http.paths.push({
                    ...path && {path},
                    pathType: 'Prefix',
                    backend: {
                        serviceName: serviceName.toLowerCase(),
                        servicePort
                    }
                });
                prev.ingressRules[name + '@' + (host || '')] = ingressRule;
            } else {
                ingress.spec.backend = {
                    serviceName: serviceName.toLowerCase(),
                    servicePort
                };
            }
            prev.ingresses[ingressKey] = ingress;
        };
        const addService = ({name, port, targetPort, protocol = 'TCP', clusterIP, loadBalancerIP, ingress, deploymentName}) => {
            const serviceKey = `services/${name.toLowerCase()}.yaml`;
            if (prev.services[serviceKey]) {
                const existing = prev.services[serviceKey].metadata.labels['app.kubernetes.io/name'];
                const error = new Error(`Duplication of service ${name} in ${existing} and ${portOrModule.config.pkg.layer}`);
                prev.errors.push(error);
                log && log.error && log.error(error);
            } else {
                prev.services[serviceKey] = {
                    apiVersion: 'v1',
                    kind: 'Service',
                    metadata: {
                        ...!kustomization && {namespace: namespace.metadata.name},
                        name: name.toLowerCase(),
                        labels: {
                            'ut.layer': portOrModule.config.pkg.layer,
                            app: deploymentName,
                            'app.kubernetes.io/name': deploymentName,
                            'app.kubernetes.io/component': portOrModule.config.pkg.name,
                            'app.kubernetes.io/version': portOrModule.config.pkg.version,
                            'app.kubernetes.io/instance': deploymentName + '_' + portOrModule.config.pkg.version,
                            ...!kustomization && commonLabels
                        }
                    },
                    spec: {
                        type: loadBalancerIP ? 'LoadBalancer' : 'ClusterIP',
                        ports: [{
                            port,
                            targetPort,
                            protocol,
                            name: targetPort
                        }],
                        selector: {
                            'app.kubernetes.io/name': deploymentName,
                            'app.kubernetes.io/version': config.version,
                            'app.kubernetes.io/instance': config.implementation + '_' + config.version,
                            ...!kustomization && commonLabels
                        },
                        ...clusterIP && {clusterIP},
                        ...loadBalancerIP && {loadBalancerIP}
                    }
                };
            }
            if (ingress) {
                [].concat(ingress).forEach(ingressConfig => ingressConfig && addIngress({
                    ...ingressConfig,
                    servicePort: targetPort,
                    serviceName: name.toLowerCase()
                }));
            }
        };
        if (deploymentNames.length) {
            deploymentNames.forEach(deploymentName => {
                const deploymentKey = `deployments/${deploymentName}.yaml`;
                const deployment = prev.deployments[deploymentKey] || {
                    apiVersion: 'apps/v1',
                    kind: 'Deployment',
                    metadata: {
                        ...!kustomization && {namespace: namespace.metadata.name},
                        name: deploymentName,
                        labels: {
                            'app.kubernetes.io/name': deploymentName,
                            ...!kustomization && deploymentLabels,
                            ...!kustomization && commonLabels
                        }
                    },
                    spec: {
                        replicas: 1,
                        selector: {
                            matchLabels: {
                                'app.kubernetes.io/name': deploymentName,
                                ...!kustomization && deploymentLabels,
                                ...!kustomization && commonLabels
                            }
                        },
                        template: {
                            metadata: {
                                ...!kustomization && {
                                    annotations: commonAnnotations
                                },
                                labels: {
                                    app: deploymentName,
                                    'app.kubernetes.io/name': deploymentName,
                                    ...!kustomization && deploymentLabels,
                                    ...!kustomization && commonLabels
                                }
                            },
                            spec: {
                                ...nodeSelector,
                                volumes: [{
                                    name: 'config',
                                    secret: {
                                        secretName: kustomization ? 'config' : prev.secrets['secrets/config.yaml'].metadata.name
                                    }
                                }, k8s && k8s.minikube && {
                                    name: 'ut',
                                    hostPath: {
                                        path: '/ut/impl'
                                    }
                                }].filter(x => x),
                                ...k8s.username && k8s.password && {imagePullSecrets: [{name: 'docker'}]},
                                containers: [{
                                    image: kustomization ? 'impl' : image,
                                    args: [
                                        config.params.app,
                                        '--service=' + deploymentName,
                                        kustomization && '--config=' + mountPath + '/rc',
                                        (deploymentName === 'console') && '--utLog.streams.udp=0'
                                    ].filter(x => x),
                                    ...containerDefaults
                                }]
                            }
                        }
                    }
                };
                const container = deployment.spec.template.spec.containers[0];
                const args = container.args;
                if (!args.includes('--' + layer)) args.push('--' + layer);
                container.ports = [...container.ports, ...containerPorts];
                prev.deployments[deploymentKey] = deployment;
            });
            if (deploymentNames.length === 1) {
                portOrModule.config.id && portOrModule.config.type !== 'module' && addService({
                    name: portOrModule.config.id.replace(/\./g, '-') + '-service',
                    deploymentName: deploymentNames[0],
                    port: 8090,
                    targetPort: 'http-jsonrpc'
                });
                [].concat(portOrModule.config.namespace).forEach(ns => ns && addService({
                    name: ns.replace(/\//g, '-') + '-service',
                    deploymentName: deploymentNames[0],
                    port: 8090,
                    targetPort: 'http-jsonrpc',
                    ingress: [ingressConfig.rpc && {
                        name: 'ut-rpc',
                        path: `/rpc/${ns.replace(/\//g, '-')}/`
                    }, ingressConfig.assets && {
                        name: 'ut-asset',
                        path: `/a/${ns.replace(/\//g, '-')}/`
                    }, ingressConfig.apiDocs && {
                        name: 'ut-api-docs',
                        path: `/api/${ns.replace(/\//g, '-')}`
                    }]
                }));
                ports.forEach(port => port.service && addService({
                    name: portOrModule.config.id.replace(/\./g, '-') + '-' + port.name,
                    deploymentName: deploymentNames[0],
                    port: port.containerPort,
                    protocol: port.protocol,
                    targetPort: port.name,
                    ...port.service
                }));
                ports.forEach(port => port.ingress && [].concat(port.ingress).forEach(ingressConfig => ingressConfig && addIngress({
                    name: deploymentNames[0] + '-' + port.name,
                    serviceName: portOrModule.config.id.replace(/\./g, '-') + '-' + port.name,
                    servicePort: port.name,
                    ...ingressConfig
                })));
            }
        };
        return prev;
    }, {
        namespace,
        kustomizations: {
            'kustomization.yaml': {
                apiVersion: 'kustomize.config.k8s.io/v1beta1',
                kind: 'Kustomization',
                namespace: namespace.metadata.name,
                bases: [],
                commonLabels: commonLabels
            }
        },
        namespaces: {
            [`namespaces/${namespace.metadata.name}.yaml`]: namespace
        },
        secrets: {
            'secrets/config.yaml': kustomization ? configFile.content : {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: {
                    ...!kustomization && {namespace: namespace.metadata.name},
                    name: 'config-' + configFile.hash
                },
                type: 'Opaque',
                stringData: {
                    config: configFile.content
                }
            },
            ...k8s.username && k8s.password && {
                'secrets/docker.yaml': {
                    apiVersion: 'v1',
                    kind: 'Secret',
                    metadata: {
                        ...!kustomization && {namespace: namespace.metadata.name},
                        name: 'docker'
                    },
                    type: 'kubernetes.io/dockerconfigjson',
                    data: {
                        '.dockerconfigjson': Buffer.from(JSON.stringify({
                            auths: {
                                [k8s.repository]: {auth: Buffer.from(`${k8s.username}:${k8s.password}`).toString('base64')}
                            }
                        })).toString('base64')
                    }
                }
            }
        },
        services: {
            ...k8s.fluentbit && {
                'services/fluentbit.yaml': fluentbit({
                    ...!kustomization && {namespace: namespace.metadata.name},
                    nodeSelector,
                    ...k8s.fluentbit
                }).service
            }
        },
        deployments: {
            ...k8s.fluentbit && {
                'deployments/fluentbit.yaml': fluentbit({
                    ...!kustomization && {namespace: namespace.metadata.name},
                    nodeSelector,
                    ...k8s.fluentbit
                }).deployment
            }
        },
        ingresses: {},
        ingressRules: {},
        errors: []
    });
    if (kustomization) {
        ['namespaces', 'deployments', 'secrets', 'services', 'ingresses'].forEach(name => {
            if (Object.keys(result[name]).length) {
                result.kustomizations[`${name}/kustomization.yaml`] = {
                    apiVersion: 'kustomize.config.k8s.io/v1beta1',
                    kind: 'Kustomization',
                    resources: Object.entries(result[name]).map(([key, value]) => (typeof value !== 'string') && path.basename(key)).filter(Boolean)
                };
                result.kustomizations['kustomization.yaml'].bases.push(name);
            }
        });
        Object.assign(result.kustomizations['deployments/kustomization.yaml'], {
            commonLabels: deploymentLabels,
            commonAnnotations
        });
        result.kustomizations['secrets/kustomization.yaml'].secretGenerator = [{
            name: 'config',
            files: ['config=config.yaml'],
            literals: [
                'rc=install: ' + mountPath + '/rc'
            ],
            type: 'Opaque'
        }];
    }
    return result;
};
