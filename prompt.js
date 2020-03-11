const inquirer = require('inquirer');
const fuzzy = require('fuzzy');
inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));

module.exports = jobs => inquirer.prompt({
    type: 'autocomplete',
    name: 'job',
    message: 'select job to run (type for fuzzy search)',
    pageSize: 20,
    source: async(answers, input) => {
        return fuzzy.filter(
            input || '',
            jobs, {
                extract: job => job.name
            }).map(s => ({ name: s.string, value: s.original }));
    }
}).then(selected => [selected.job]);
