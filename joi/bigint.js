const bigintRegex = /^[1-9]{1}[0-9]{0,18}$/;
module.exports = joi => ({
    type: 'bigint',
    base: joi.any(),
    messages: {
        'bigint.base': '{{#label}} must be a bigint'
    },
    validate(value, helpers) {
        if (!bigintRegex.test(String(value))) return { value, errors: helpers.error('bigint.base') };
    }
});
