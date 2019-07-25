const create = require('./create');
const {strOptions} = require('yaml/types');
const yaml = require('yaml');
const editConfig = require('ut-config').edit;

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
        const finishForm = await editConfig({edit: {server: mergedConfig.run.edit.server}});
        const editForm = await editConfig({edit: {server: mergedConfig.run.edit.server, id: mergedConfig.run.edit.id}});
        let secret;

        let schema = service.schema();

        editConfig({
            log,
            edit: {
                ...mergedConfig.run.edit,
                ...schema,
                id: editForm.id,
                submit: async({payload}) => {
                    secret = yaml.stringify(payload);
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

        const kustomize = await editConfig({
            log,
            edit: {
                handler: async({type}) => {
                    switch (type) {
                        case 'k8s':
                            let result = service.kustomize({layers: mergedConfig.run.layers, config: mergedConfig, secret});
                            let lineWidth = strOptions.fold.lineWidth; // yet another stupid singleton
                            try {
                                strOptions.fold.lineWidth = 1e6;
                                result = [
                                    result.namespace,
                                    ...Object.values(result.secrets),
                                    ...Object.values(result.deployments),
                                    ...Object.values(result.services),
                                    ...Object.values(result.ingresses)
                                ].map(item => yaml.stringify(item));
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
                                payload: secret,
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
                    secret = yaml.stringify(payload);
                    return {
                        payload: {
                            state: {
                                schema: {
                                    title: 'Null field example',
                                    description: 'A short form with a null field'
                                }
                            }
                        }
                    };
                }
            },
            formData: {
                kubectl: 'kubectl apply -f ' + kustomize.href + '?type=k8s',
                k8s: kustomize.href + '?type=k8s',
                rc: kustomize.href
            }
        });

        for (const port of ports) {
            await port.destroy();
        }
    }
    serviceBus && await serviceBus.destroy();
    broker && await broker.destroy();
};
