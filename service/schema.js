const set = (object, property, schema, uiSchema) => {
    if (property && schema) {
        property.split('.').reduce((prev, name, index, array) => {
            const value = (index === array.length - 1) ? schema : {type: 'object', properties: {}};
            prev.properties = prev.properties || {};
            prev.properties[name] = prev.properties[name] || value;
            return prev.properties[name];
        }, object.schema);
    }
    if (property && uiSchema) {
        property.split('.').reduce((prev, name, index, array) => {
            const value = (index === array.length - 1) ? uiSchema : {};
            prev[name] = prev[name] || value;
            return prev[name];
        }, object.uiSchema);
    }
};

module.exports = ({portsAndModules, log, schema, uiSchema = {}}) => {
    return portsAndModules.reduce((prev, portOrModule) => {
        set(
            prev,
            portOrModule.config && portOrModule.config.id,
            portOrModule.configSchema,
            portOrModule.uiSchema
        );
        return prev;
    }, {
        schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'Configuration',
            type: 'object',
            ...schema
        },
        uiSchema
    });
};
