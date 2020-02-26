const dropReadOnly = param => {
    if (param && param.properties) {
        const {properties, ...rest} = param;
        return {
            properties: Object.entries(properties).reduce((prev, [key, value]) => {
                if (!value || !value.readOnly) {
                    const editable = dropReadOnly(value);
                    // drop objects without properties
                    if (!editable || !editable.properties || Object.keys(editable.properties).length) {
                        prev[key] = editable;
                    }
                }
                return prev;
            }, {}),
            ...rest
        };
    };
    return param;
};

const set = (object, config, schema, uiSchema) => {
    if (!schema || !config || !config.id) return;
    const editable = dropReadOnly(schema);
    if (editable && (!editable.properties || Object.keys(editable.properties).length)) {
        const tokens = config.id.split('.');
        tokens.reduce((prev, name, index, array) => {
            const value = (index === array.length - 1) ? editable : {type: 'object', properties: {}};
            prev.properties = prev.properties || {};
            prev.properties[name] = prev.properties[name] || value;
            return prev.properties[name];
        }, object.schema);
        tokens.reduce((prev, name, index, array) => {
            const value = (index === array.length - 1) ? config : {};
            prev[name] = prev[name] || value;
            return prev[name];
        }, object.formData);
        if (uiSchema) {
            tokens.reduce((prev, name, index, array) => {
                const value = (index === array.length - 1) ? uiSchema : {};
                prev[name] = prev[name] || value;
                return prev[name];
            }, object.uiSchema);
        }
    }
};

module.exports = ({portsAndModules, log, schema, uiSchema = {}, formData = {}}) => {
    return portsAndModules.reduce((prev, {config, configSchema, configUiSchema}) => {
        set(prev, config, configSchema, configUiSchema);
        return prev;
    }, {
        schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'Configuration',
            type: 'object',
            ...schema
        },
        uiSchema,
        formData
    });
};
