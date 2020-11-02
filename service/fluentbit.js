module.exports = ({
    namespace,
    nodeSelector,
    elasticsearch,
    loki,
    stdout,
    version = '1.6'
}) => {
    const labels = {
        'app.kubernetes.io/name': 'fluent-bit',
        'app.kubernetes.io/version': version,
        'app.kubernetes.io/instance': 'fluent-bit_' + version
    };
    return {
        service: {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                ...namespace && {namespace},
                name: 'fluent-bit',
                labels
            },
            spec: {
                type: 'ClusterIP',
                ports: [{
                    port: 24224,
                    protocol: 'TCP',
                    name: 'forward'
                }],
                selector: {...labels}
            }
        },
        deployment: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: {
                ...namespace && {namespace},
                name: 'fluent-bit',
                labels: {...labels}
            },
            spec: {
                replicas: 1,
                selector: {
                    matchLabels: {...labels}
                },
                template: {
                    metadata: {
                        labels: {...labels},
                        annotations: {
                            'prometheus.io/scrape': 'true',
                            'prometheus.io/port': '2020',
                            'prometheus.io/path': '/api/v1/metrics/prometheus'
                        }
                    },
                    spec: {
                        ...nodeSelector,
                        terminationGracePeriodSeconds: 10,
                        containers: [{
                            name: 'fluent-bit',
                            image: 'fluent/fluent-bit:' + version,
                            imagePullPolicy: 'IfNotPresent',
                            args: [
                                '/fluent-bit/bin/fluent-bit',
                                '-i',
                                'forward',
                                ...elasticsearch ? [
                                    '-o',
                                    'es',
                                    '-p',
                                    'Host=' + (elasticsearch.host || 'elasticsearch'),
                                    '-p',
                                    'Port=' + (elasticsearch.port || '9200'),
                                    '-p',
                                    'Index=ut',
                                    '-p',
                                    'Type=_doc',
                                    '-p',
                                    'Buffer_Size=64KB',
                                    '-p',
                                    'Retry_Limit=1',
                                    '-m',
                                    '*'
                                ] : [],
                                ...loki ? [
                                    '-o',
                                    'loki',
                                    '-p',
                                    'host=' + (loki.host || 'loki.monitoring.svc.cluster.local'),
                                    '-p',
                                    'labels=job=ut',
                                    '-p',
                                    'label_keys=$name,$context,$service,$impl,$env,$level',
                                    '-m',
                                    '*'
                                ] : [],
                                ...stdout ? [
                                    '-o',
                                    'stdout',
                                    '-m',
                                    '*'
                                ] : [],
                                '-v'
                            ],
                            ports: [{
                                name: 'http-prometheus',
                                protocol: 'TCP',
                                containerPort: 2020
                            },
                            {
                                name: 'tcp-forward',
                                protocol: 'TCP',
                                containerPort: 24224
                            }]
                        }]
                    }
                }
            }
        }
    };
};
