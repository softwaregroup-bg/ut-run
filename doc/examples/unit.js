const dispatch = require('ut-function.dispatch');
require('ut-run').run({
    main: dispatch({
        'subject.object.predicate': () => 'hello world'
    }),
    method: 'unit',
    config: {},
    params: {
        steps: [{
            method: 'subject.object.predicate',
            name: 'call subject.object.predicate',
            result: (result, assert) =>
                assert.equals(result, 'hello world', 'return hello world')
        }]
    }
});
