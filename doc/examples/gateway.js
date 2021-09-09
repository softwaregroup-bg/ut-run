const dispatch = require('ut-function.dispatch');

require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'subject.object.predicate': () => 'hello world'
            })
        ],
        gateway: [
            function validation({joi}) {
                return {
                    'subject.object.predicate': () => ({
                        auth: false,
                        params: joi.object({}),
                        result: joi.string()
                    })
                };
            },
            require('ut-gateway')({namespace: 'apiGateway'})
        ]
    }],
    config: {
        implementation: 'api',
        utBus: {serviceBus: {jsonrpc: {domain: true}}},
        apiGateway: {
            discover: true,
            api: [
                '/oauth2-redirect.html',
                '/api/{path*}',
                '/rpc/subject/{path*}'
            ]
        }
    }
});
