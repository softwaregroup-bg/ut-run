const inquirer = require('inquirer');
const fuzzy = require('fuzzy');
inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));
const last = {name: null};

module.exports = jobs => last.name ? jobs.filter(({name}) => name === last.name) : inquirer.prompt({
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
}).then(selected => {
    last.name = selected.job.name;
    return [selected.job];
});
