const dispatch = require('ut-function.dispatch');
require('ut-run').run({
    main: [{
        orchestrator: [
            dispatch({
                'subject.object.predicate': () => 'hello world'
            })
        ]
    }],
    config: {
        implementation: 'ut',
        utBus: {serviceBus: {jsonrpc: {domain: true}}}
    }
});
