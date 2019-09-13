const create = require('./create');
const {strOptions} = require('yaml/types');
const yaml = require('yaml');
const editConfig = require('ut-config').edit;
const merge = require('ut-function.merge');

module.exports = async function(serviceConfig, envConfig, assert) {
    const {broker, serviceBus, service, mergedConfig, log} = await create(envConfig);
    if (service) {
        if (!mergedConfig.run || !mergedConfig.run.layers) {
            throw new Error('Missing run.layers in the configuration');
        }
        if (!mergedConfig.run || !mergedConfig.run.edit) {
            throw new Error('Missing run.edit in the configuration');
        }
        Object.keys(mergedConfig.run.layers).forEach(name => { // enable all layers in run.layers
            const [utModule, layer] = name.split('.', 2);
            if (!mergedConfig[utModule]) mergedConfig[utModule] = {[layer]: true};
            if (!mergedConfig[utModule][layer]) mergedConfig[utModule][layer] = true;
        });
        const ports = await service.create(serviceConfig, mergedConfig, assert);
        const finishForm = await editConfig({log, edit: {server: mergedConfig.run.edit.server}});
        const editForm = await editConfig({log, edit: {server: mergedConfig.run.edit.server, id: mergedConfig.run.edit.id}});
        let secret;

        let schema = service.schema({
            schema: {
                properties: {
                    k8s: {
                        type: 'object',
                        properties: {
                            repository: {
                                type: 'string',
                                default: (mergedConfig.k8s && mergedConfig.k8s.minikube) ? '' : 'nexus-dev.softwaregroup.com:5001'
                            },
                            username: {
                                type: 'string'
                            },
                            password: {
                                type: 'string'
                            },
                            image: {
                                type: 'string',
                                default: 'ut/impl-' + mergedConfig.implementation + ':' +
                                    ((mergedConfig.k8s && mergedConfig.k8s.minikube) ? 'minikube' : mergedConfig.version)
                            },
                            pull: {
                                type: 'string',
                                title: 'Image pull policy',
                                enum: ['Always', 'IfNotPresent', 'Never']
                            },
                            namespace: {
                                type: 'string',
                                default: mergedConfig.implementation + '-' + mergedConfig.params.env
                            },
                            node: {
                                type: 'string',
                                title: 'Install only on node'
                            },
                            architecture: {
                                type: 'string',
                                title: 'Install only on architecture'
                            },
                            istio: {
                                type: 'boolean',
                                title: 'Enable Istio',
                                default: true
                            },
                            fluentbit: {
                                type: 'object',
                                title: 'Fluent Bit configuration',
                                properties: {
                                    host: {
                                        type: 'string',
                                        title: 'Elasticsearch host'
                                    },
                                    port: {
                                        type: ['integer', 'null'],
                                        title: 'Elasticsearch port'
                                    }
                                }
                            }
                        }
                    }
                }
            },
            uiSchema: {
                k8s: {
                    password: {
                        'ui:widget': 'password',
                        'ui:emptyValue': ''
                    },
                    repository: {
                        'ui:emptyValue': ''
                    },
                    username: {
                        'ui:emptyValue': ''
                    },
                    image: {
                        'ui:emptyValue': ''
                    },
                    namespace: {
                        'ui:emptyValue': ''
                    },
                    node: {
                        'ui:emptyValue': ''
                    },
                    architecture: {
                        'ui:emptyValue': ''
                    },
                    pull: {
                        'ui:emptyValue': ''
                    }
                }
            }
        });

        editConfig({
            log,
            edit: {
                ...mergedConfig.run.edit,
                ...schema,
                id: editForm.id,
                submit: async({payload}) => {
                    merge(mergedConfig, {k8s: payload.k8s});
                    delete payload.k8s;
                    secret = payload;
                    return {
                        payload: {
                            redirect: finishForm.url.pathname
                        }
                    };
                }
            },
            filename: mergedConfig.config
        });

        log && log.warn && log.warn('Edit configuration at ' + editForm.url.href);

        const install = await editConfig({
            log,
            edit: {
                server: mergedConfig.run.edit.server,
                handler: async({type}) => {
                    switch (type) {
                        case 'k8s':
                            let result = service.install({layers: mergedConfig.run.layers, config: mergedConfig, secret});
                            let lineWidth = strOptions.fold.lineWidth; // yet another stupid singleton
                            try {
                                strOptions.fold.lineWidth = 1e6;
                                result = [
                                    result.namespace,
                                    ...Object.values(result.secrets),
                                    ...Object.values(result.deployments),
                                    ...Object.values(result.services),
                                    ...Object.values(result.ingresses)
                                ].filter(x => x).map(item => yaml.stringify(item));
                            } finally {
                                strOptions.fold.lineWidth = lineWidth;
                            }
                            return {
                                payload: result.join('---\n'),
                                headers: {
                                    'Content-Type': 'application/x-yaml',
                                    'Content-Disposition': 'attachment; filename = "k8s.yaml"'
                                }
                            };
                        default:
                            return {
                                payload: yaml.stringify(secret),
                                headers: {
                                    'Content-Type': 'text/plain',
                                    'Content-Disposition': 'inline'
                                }
                            };
                    }
                }
            }
        });

        await editConfig({
            log,
            edit: {
                id: finishForm.id,
                server: mergedConfig.run.edit.server,
                schema: {
                    $schema: 'http://json-schema.org/draft-07/schema#',
                    type: 'object',
                    title: 'Install options',
                    properties: {
                        kubectl: {
                            type: 'string',
                            title: 'To install with kubectl directly, run this in a shell',
                            readOnly: true
                        },
                        k8s: {
                            type: 'string',
                            title: 'Download k8s YAML file',
                            readOnly: true
                        },
                        rc: {
                            type: 'string',
                            title: `Download .${mergedConfig.params.appname}rc file`,
                            readOnly: true
                        }
                    }
                },
                buttons: [{
                    title: 'Done'
                }],
                uiSchema: {
                    kubectl: {
                        'ui:widget': 'textarea',
                        'ui:autofocus': true
                    }
                },
                submit: async({payload}) => {
                    return {
                        payload: {
                            state: {
                                schema: {
                                    title: 'Configuration completed',
                                    description: 'You can now close this page',
                                    type: 'object',
                                    properties: {}
                                },
                                buttons: []
                            }
                        }
                    };
                }
            },
            formData: {
                kubectl: 'kubectl apply -f ' + install.href + '?type=k8s',
                k8s: install.href + '?type=k8s',
                rc: install.href
            }
        });

        for (const port of ports) {
            await port.destroy();
        }
    }
    serviceBus && await serviceBus.destroy();
    broker && await broker.destroy();
};
