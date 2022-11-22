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
        content,
        // https://github.com/kubernetes/kubernetes/blob/release-1.15/staging/src/k8s.io/cli-runtime/pkg/kustomize/k8sdeps/transformer/hash/hash.go#L123
        hash: hash(content)
    };
};

module.exports = ({portsAndModules, log, layers, config, secret, kustomization}) => {
    const k8s = config.k8s || {};
    const docker = (k8s.username && k8s.password && `${k8s.username}:${k8s.password}`);
    const image = (k8s.repository ? k8s.repository + '/' : '') + (k8s.image || (`ut/impl-${config.implementation}:${config.version}`));
    const appname = `ut_${config.implementation.replace(/[-/\\]/g, '_')}_${config.params.env}`.toLowerCase();
    const mountPath = `/etc/${appname}`;
    const mountPathAppRc = `/app/.${appname}rc`;
    const mountPathEtcRc = `/etc/${appname}rc`;
    const allDeployments = Object.values(layers).join(',').split(/\s*,\s*/).filter((l, i, a) => l !== '*' && a.indexOf(l) === i);
    const commonLabels = merge({
        'app.kubernetes.io/part-of': config.implementation,
        'app.kubernetes.io/managed-by': 'ut-run'
    }, k8s.labels);
    const deploymentLabels = {
        version: config.version,
        'app.kubernetes.io/version': config.version,
        'app.kubernetes.io/instance': `${config.implementation}_${config.version}`
    };
    const commonAnnotations = merge({
        'prometheus.io/scrape': 'true',
        'prometheus.io/port': '8090',
        'prometheus.io/scheme': 'http'
    }, k8s.annotations);
    const containerDefaults = () => merge({
        name: 'ut',
        env: [{
            name: 'UT_ENV',
            value: config.params.env
        }],
        volumeMounts: [{
            name: 'config',
            mountPath
        }, {
            name: 'apprc',
            mountPath: mountPathAppRc,
            subPath: path.basename(mountPathAppRc)
        }, {
            name: 'etcrc',
            mountPath: mountPathEtcRc,
            subPath: path.basename(mountPathEtcRc)
        }, k8s && k8s.minikube && {
            name: 'ut',
            mountPath: '/ut/impl'
        }].filter(x => x),
        resources: {
            limits: {
                memory: '250M',
                cpu: '1'
            },
            requests: {
                memory: '100M',
                cpu: '0.10'
            }
        },
        ports: [{
            name: 'http-jsonrpc',
            protocol: 'TCP',
            containerPort: 8090
        }],
        livenessProbe: {
            periodSeconds: 10,
            timeoutSeconds: 5,
            failureThreshold: 6,
            httpGet: {
                path: '/healthz',
                port: 'http-jsonrpc'
            }
        },
        readinessProbe: {
            periodSeconds: 10,
            timeoutSeconds: 5,
            httpGet: {
                path: '/healthz',
                port: 'http-jsonrpc'
            }
        },
        startupProbe: {
            periodSeconds: 2,
            failureThreshold: 60,
            httpGet: {
                path: '/healthz',
                port: 'http-jsonrpc'
            }
        }
    }, k8s.container);
    const jobContainerDefaults = (({
        ports,
        livenessProbe,
        readinessProbe,
        startupProbe,
        ...rest
    }) => merge({}, rest, {
        resources: {
            requests: {
                cpu: '0.01'
            }
        }
    }, k8s.job))(containerDefaults());
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
                    ...k8s.fluentbit && k8s.fluentbit.stream && {
                        fluentbit: {
                            level: 'trace',
                            stream: '../fluentdStream',
                            streamConfig: {
                                host: (k8s.fluentbit.elasticsearch || k8s.fluentbit.loki) ? 'fluent-bit' : 'fluent-bit.logging.svc.cluster.local',
                                port: 24224,
                                ...k8s.fluentbit.stream
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
            name: k8s.namespace || (`${config.implementation}-${config.params.env}`),
            labels: {
                'istio-injection': 'enabled'
            }
        }
    };
    const secretName = kustomization ? 'config' : 'config-' + configFile.hash;
    const podDefaults = () => merge({
        ...(docker || k8s.pullSecrets !== false) && {imagePullSecrets: [{name: 'docker'}]},
        volumes: [{
            name: 'config',
            secret: {
                secretName
            }
        }, {
            name: 'apprc',
            secret: {
                secretName: 'rc',
                items: [{
                    key: 'rc.yaml',
                    path: path.basename(mountPathAppRc)
                }]
            }
        }, {
            name: 'etcrc',
            secret: {
                secretName: 'etcrc',
                optional: true,
                items: [{
                    key: 'etcrc.yaml',
                    path: path.basename(mountPathEtcRc)
                }]
            }
        }, k8s && k8s.minikube && {
            name: 'ut',
            hostPath: {
                path: '/ut/impl'
            }
        }].filter(Boolean)
    }, k8s.pod);
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
        const ingresses = (portOrModule.config.k8s && portOrModule.config.k8s.ingresses) || [];
        const volumes = (portOrModule.config.k8s && portOrModule.config.k8s.volumes) || [];
        const portOrModuleName = portOrModule.config.id.replace(/\./g, '-');
        const containerPorts = ports.map(port => ({
            name: port.name,
            protocol: port.protocol || 'TCP',
            containerPort: port.containerPort
        }));
        const deploymentNames = layers[layer] === '*'
            ? allDeployments
            : (layers[layer] || '').split(/\s*,\s*/).filter(x => x);
        const addIngress = ({path, host, name, servicePort, serviceName, pathType = 'Prefix', apiVersion = 'networking.k8s.io/v1', tls}) => {
            const ingressKey = `ingresses/${name}.yaml`;
            const ingress = prev.ingresses[ingressKey] || {
                apiVersion,
                kind: 'Ingress',
                metadata: {
                    ...!kustomization && {namespace: namespace.metadata.name},
                    name
                },
                spec: {}
            };
            if (host || path) {
                if (!ingress.spec.rules) ingress.spec.rules = [];
                const ingressRule = prev.ingressRules[`${name}@${host || ''}`] || {
                    ...host && {host},
                    http: {
                        paths: []
                    }
                };
                if (!ingressRule.http.paths.length) ingress.spec.rules.push(ingressRule);
                if (tls && host) {
                    ingress.metadata.annotations = ingress.metadata.annotations || {};
                    ingress.metadata.annotations['traefik.ingress.kubernetes.io/router.tls'] = 'true';
                    if (!ingress.spec.tls) ingress.spec.tls = [{hosts: [], secretName: name + '-tls'}];
                    if (!ingress.spec.tls[0].hosts.includes(host)) ingress.spec.tls[0].hosts.push(host);
                    const {manager = 'certmanager'} = tls;
                    if (['certmanager', 'cert-manager.io', 'cert-manager.io/v1'].includes(manager)) {
                        ingress.metadata.annotations['cert-manager.io/cluster-issuer'] = tls.issuer || 'letsencrypt';
                    };
                }
                switch (apiVersion) {
                    case 'extensions/v1beta1':
                    case 'networking.k8s.io/v1beta1':
                        ingressRule.http.paths.push({
                            path: path || '/',
                            backend: {
                                serviceName: serviceName.toLowerCase(),
                                servicePort
                            }
                        });
                        break;
                    default:
                        ingressRule.http.paths.push({
                            path: path || '/',
                            pathType,
                            backend: {
                                service: {
                                    name: serviceName.toLowerCase(),
                                    port: {
                                        name: servicePort
                                    }
                                }
                            }
                        });
                }
                prev.ingressRules[`${name}@${host || ''}`] = ingressRule;
            } else {
                ingress.spec.backend = {
                    serviceName: serviceName.toLowerCase(),
                    servicePort
                };
            }
            prev.ingresses[ingressKey] = ingress;
        };
        const addService = ({name, port, targetPort, protocol = 'TCP', clusterIP, loadBalancerIP, ingress, deploymentName, allowDuplication}) => {
            const serviceKey = `services/${name.toLowerCase()}.yaml`;
            if (prev.services[serviceKey]) {
                const existing = prev.services[serviceKey].metadata.labels['app.kubernetes.io/name'];
                if (allowDuplication && existing === deploymentName) return;
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
                            'app.kubernetes.io/instance': `${deploymentName}_${portOrModule.config.pkg.version}`,
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
                            ...!kustomization && commonLabels
                        },
                        ...clusterIP && {clusterIP},
                        ...loadBalancerIP && {loadBalancerIP}
                    }
                };
            }
            if (ingress) {
                [].concat(ingress).forEach(config => config && addIngress({
                    ...ingressConfig,
                    ...config,
                    servicePort: targetPort,
                    serviceName: name.toLowerCase()
                }));
            }
        };
        if (deploymentNames.length) {
            deploymentNames.forEach(deploymentName => {
                const auto = !deploymentName.startsWith('?');
                deploymentName = deploymentName.replace(/^\?/, '');
                const deploymentKey = `deployments/${deploymentName}.yaml`;
                const deployment = prev.deployments[deploymentKey] || {
                    apiVersion: 'apps/v1',
                    kind: 'Deployment',
                    metadata: {
                        ...!kustomization && {namespace: namespace.metadata.name},
                        name: deploymentName,
                        labels: {
                            'app.kubernetes.io/name': deploymentName,
                            ...deploymentLabels,
                            ...!kustomization && commonLabels
                        }
                    },
                    spec: {
                        replicas: 1,
                        selector: {
                            matchLabels: {
                                'app.kubernetes.io/name': deploymentName,
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
                                    ...deploymentLabels,
                                    ...!kustomization && commonLabels
                                }
                            },
                            spec: {
                                ...nodeSelector,
                                serviceAccountName: 'ut',
                                ...podDefaults(),
                                initContainers: [{
                                    name: 'db-create-wait',
                                    image: 'd3fk/kubectl:v1.18',
                                    args: ['wait', '--for=condition=complete', '--timeout=300s', 'job/db-create']
                                }],
                                containers: [{
                                    image: kustomization ? 'impl' : image,
                                    args: [
                                        config.params.app,
                                        '--service=' + deploymentName,
                                        (deploymentName === 'console') && '--utLog.streams.udp=0'
                                    ].filter(x => x),
                                    ...containerDefaults()
                                }]
                            }
                        }
                    }
                };
                const container = deployment.spec.template.spec.containers[0];
                const args = container.args;
                if (auto && !args.includes('--' + layer)) args.push('--' + layer);
                container.ports = [...container.ports, ...containerPorts];
                prev.deployments[deploymentKey] = deployment;
                function addIfNotExists(where, item) {
                    if (!where.find(({name}) => name === item.name)) where.push(item);
                }
                Object.entries(volumes).forEach(([name, volume]) => {
                    addIfNotExists(container.volumeMounts, {
                        name: `${portOrModuleName}-${name}-volume`.toLowerCase(),
                        mountPath: volume
                    });
                    addIfNotExists(deployment.spec.template.spec.volumes, {
                        name: `${portOrModuleName}-${name}-volume`.toLowerCase(),
                        persistentVolumeClaim: {
                            claimName: `${portOrModuleName}-${name}-claim`.toLowerCase()
                        }
                    });
                });
            });
            if (deploymentNames.length === 1) {
                const auto = !deploymentNames[0].startsWith('?');
                const deploymentName = deploymentNames[0].replace(/^\?/, '');
                portOrModule.config.id && portOrModule.config.type !== 'module' && addService({
                    name: portOrModuleName + '-service',
                    deploymentName,
                    port: 8090,
                    targetPort: 'http-jsonrpc'
                });
                [].concat(portOrModule.config.namespace).forEach(ns => ns && addService({
                    name: ns.replace(/\//g, '-') + '-service',
                    allowDuplication: !auto,
                    deploymentName,
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
                    name: `${portOrModuleName}-${port.name}`,
                    deploymentName,
                    port: port.containerPort,
                    protocol: port.protocol,
                    targetPort: port.name,
                    ...port.service
                }));
                ports.forEach(port => port.ingress && [].concat(port.ingress).forEach(config => config && addIngress({
                    ...ingressConfig,
                    name: `${deploymentName}-${port.name}`,
                    serviceName: `${portOrModuleName}-${port.name}`,
                    servicePort: port.name,
                    ...config
                })));
            }
        }
        if (![undefined, null, false].includes(layers[layer])) ingresses.forEach(ingress => addIngress({...ingressConfig, ...ingress}));
        return prev;
    }, {
        namespace,
        kustomizations: {
            'kustomization.yaml': {
                apiVersion: 'kustomize.config.k8s.io/v1beta1',
                kind: 'Kustomization',
                namespace: namespace.metadata.name,
                bases: [],
                commonLabels
            }
        },
        namespaces: {
            [`namespaces/${namespace.metadata.name}.yaml`]: namespace
        },
        jobs: {
            'jobs/db-create.yaml': {
                apiVersion: 'batch/v1',
                kind: 'Job',
                metadata: {
                    name: 'db-create'
                },
                spec: {
                    backoffLimit: 0,
                    template: {
                        metadata: {
                            annotations: {
                                'sidecar.istio.io/inject': 'false'
                            }
                        },
                        spec: {
                            ...podDefaults(),
                            containers: [{
                                name: 'ut',
                                image: 'impl',
                                // TODO temporary fix for fluent-logger socket
                                args: ['server', '--overlay=db', '--run.stop', '--utLog.streams.fluentbit=false', `--config=${mountPath}/rc`],
                                ...jobContainerDefaults
                            }],
                            restartPolicy: 'Never'
                        }
                    }
                }
            }
        },
        rbac: {
            'rbac/ut.yaml': {
                apiVersion: 'v1',
                kind: 'ServiceAccount',
                metadata: {
                    name: 'ut'
                }
            },
            'rbac/view-jobs.yaml': {
                apiVersion: 'rbac.authorization.k8s.io/v1',
                kind: 'Role',
                metadata: {
                    name: 'view-jobs'
                },
                rules: [{
                    verbs: ['get', 'list', 'watch'],
                    apiGroups: ['batch'],
                    resources: ['cronjobs', 'cronjobs/status', 'jobs', 'jobs/status']
                }]
            },
            'rbac/ut-binding.yaml': {
                apiVersion: 'rbac.authorization.k8s.io/v1',
                kind: 'RoleBinding',
                metadata: {
                    name: 'ut-binding'
                },
                subjects: [{
                    kind: 'ServiceAccount',
                    name: 'ut'
                }],
                roleRef: {
                    apiGroup: 'rbac.authorization.k8s.io',
                    kind: 'Role',
                    name: 'view-jobs'
                }
            }
        },
        secrets: {
            'secrets/config.yaml': kustomization ? configFile.content : {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: {
                    ...!kustomization && {namespace: namespace.metadata.name},
                    name: secretName
                },
                type: 'Opaque',
                stringData: {
                    config: configFile.content
                }
            },
            ...docker && {
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
                                [k8s.repository]: {auth: Buffer.from(docker).toString('base64')}
                            }
                        })).toString('base64')
                    }
                }
            }
        },
        services: {
            ...k8s.fluentbit && (k8s.fluentbit.elasticsearch || k8s.fluentbit.loki) && {
                'services/fluentbit.yaml': fluentbit({
                    ...!kustomization && {namespace: namespace.metadata.name},
                    nodeSelector,
                    ...k8s.fluentbit
                }).service
            }
        },
        deployments: {
            ...k8s.fluentbit && (k8s.fluentbit.elasticsearch || k8s.fluentbit.loki) && {
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
        ['namespaces', 'deployments', 'secrets', 'services', 'ingresses', 'rbac', 'jobs'].forEach(name => {
            if (Object.keys(result[name]).length) {
                const resources = Object.entries(result[name]).map(([key, value]) => (typeof value !== 'string') && path.basename(key)).filter(Boolean);
                result.kustomizations[`${name}/kustomization.yaml`] = {
                    apiVersion: 'kustomize.config.k8s.io/v1beta1',
                    kind: 'Kustomization',
                    ...resources.length && {resources}
                };
                result.kustomizations['kustomization.yaml'].bases.push(name);
            }
        });
        Object.assign(result.kustomizations['deployments/kustomization.yaml'], {
            commonAnnotations
        });
        result.kustomizations['secrets/kustomization.yaml'].secretGenerator = [{
            name: 'config',
            files: ['config=config.yaml'],
            literals: [
                `rc=install: ${mountPath}/rc`
            ],
            type: 'Opaque'
        }];
    }
    return result;
};
