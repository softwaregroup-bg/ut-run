(function() {
    var schema = window.ut.schema;
    var config = window.ut.config;
    var impl = config.implementation.replace(/[-/\\]/g, '_');
    var env = config.params.env;
    var isObject = o => o != null && typeof o === 'object';

    function intersect(original, modified) {
        if (original === modified) return {};
        if (!isObject(original) || !isObject(modified)) return modified;
        return Object.keys(modified).reduce((result, key) => {
            if (original.hasOwnProperty(key)) {
                var diff = intersect(original[key], modified[key]);
                // updated values
                if (!isObject(diff) || Object.keys(diff).length > 0) result[key] = diff;
            } else {
                // new values
                result[key] = modified[key];
            }
            return result;
        }, {});
    };

    function flatten(data) {
        var result = {};

        function recurse(cur, prop) {
            if (Object(cur) !== cur || Array.isArray(cur)) {
                result[prop] = cur;
            } else {
                var isEmpty = true;
                Object.keys(cur).forEach(function(p) {
                    isEmpty = false;
                    recurse(cur[p], prop ? prop + '.' + p : p);
                });
                if (isEmpty && prop) result[prop] = {};
            }
        }

        recurse(data, '');

        return result;
    }

    function render() {
        var build = {
            json: function() {
                var output = intersect(config, editor.get());
                outputResult.innerText = JSON.stringify(output, null, 4);
            },
            'command line arguments': function() {
                var output = intersect(config, editor.get());
                var flat = flatten(output);
                outputResult.innerText = Object.keys(flat).map(key => `--${key}=${flat[key]}`).join(' ');
            },
            'environment variables': function() {
                var output = intersect(config, editor.get());
                var flat = flatten(output);
                outputResult.innerText = Object.keys(flat).map(key => `ut_${impl}_${env}_${key.replace(/\./g, '__')}=${flat[key]}`).join('\n');
            }
        };
        var buttonsWrapper = document.getElementById('generate');
        var outputResult = document.getElementById('output').firstChild;
        var buttons = Object.keys(build).map(key => {
            var button = document.createElement('button');
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
            mode: 'tree',
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
    }

    if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', render);
    } else if (window.attachEvent) {
        window.attachEvent('onload', render);
    }
})();
