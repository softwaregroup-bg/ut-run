(function() {
    var schema = window.ut.schema;
    var config = window.ut.config;
    var isObject = o => o != null && typeof o === 'object';

    function diff(x, y) {
        if (x === y) return {};
        if (!isObject(x) || !isObject(y)) return y;
        return Object.keys(y).reduce((all, key) => {
            if (x.hasOwnProperty(key)) {
                var z = diff(x[key], y[key]);
                if (!isObject(z) || Object.keys(z).length > 0) all[key] = z;
            }
            return all;
        }, {});
    };

    function flatten(data) {
        var result = {};

        function recurse(cur, prop) {
            if (Object(cur) !== cur) {
                result[prop] = cur;
            } else if (Array.isArray(cur) || typeof cur === 'function') {
                result[prop] = cur;
            } else {
                var isEmpty = true;
                Object.keys(cur).forEach(function(p) {
                    isEmpty = false;
                    recurse(cur[p], prop ? prop + '.' + p : p);
                });
                if (isEmpty && prop) {
                    result[prop] = {};
                }
            }
        }
        recurse(data, '');
        return result;
    }
    function render() {
        var build = {
            json: function() {
                var output = diff(config, editor.get());
                outputResult.innerText = JSON.stringify(output, null, 4);
            },
            'environment variables': function() {
                var output = diff(config, editor.get());
                var flat = flatten(output);
                outputResult.innerText = Object.keys(flat).map(key => `--${key}=${flat[key]}`).join(' ');
            },
            'runtime arguments': function() {
                // TODO pass from outside
                var impl = 'impl';
                var env = 'dev';
                var output = diff(config, editor.get());
                var flat = flatten(output);
                outputResult.innerText = Object.keys(flat).map(key => `ut_${impl}_${env}_${key.replace(/\./, '__')}=${flat[key]}`).join('\n');
            }
        };
        var buttonsWrapper = document.getElementById('generate');
        var outputResult = document.getElementById('output').firstChild;
        var buttons = Object.keys(build).map(key => {
            const button = document.createElement('button');
            button.innerText = key;
            button.onclick = build[key];
            buttonsWrapper.appendChild(button);
            return button;
        });

        // Editor

        var editorContainer = document.getElementById('jsoneditor');
        var ajv = new window.JSONEditor.Ajv();
        var validate = ajv.compile(schema);
        var editorOptions = {
            modes: ['form', 'text'],
            onValidate: function(json) {
                var valid = validate(json);
                buttons.forEach(button => {
                    button.disabled = !valid;
                });
                if (!valid) outputResult.innerText = '';
                return validate.errors && validate.errors.map(err => {
                    return {
                        path: err.dataPath.split(/[.|[|.\]]/).filter(x => x),
                        message: err.message
                    };
                });
            }
        };
        var editor = new window.JSONEditor(editorContainer, editorOptions, config);
        editor.expandAll();
    }
    if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', render);
    } else if (window.attachEvent) {
        window.attachEvent('onload', render);
    }
})();
