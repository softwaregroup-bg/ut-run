#!/usr/bin/env node
/* eslint no-process-env:0 */

const pkgJson = require('../package.json');
const vfs = require('../vfs');
const serviceConfig = require(process.cwd());
const { Command } = require('commander');
const program = new Command();

program
    .name('ut-run')
    .description('ut-run cli')
    .version(pkgJson.version);

program
    .command('doc')
    .description('Generate config.md based on port config schema')
    .action(() => require('../doc')(serviceConfig, undefined, undefined, vfs));

program
    .command('changelog')
    .description('Generate combined ut-* modules changelog')
    .option('--fromVersion <fromVersion>', 'starting version the generate the changelog from')
    .option('--toolsUrl <toolsUrl>', 'url to access impl-tools running instance', process.env.IMPL_TOOLS_URL)
    .option('--toolsUsername <toolsUsername>', 'username to login to impl-tools running instance', process.env.IMPL_TOOLS_USR)
    .option('--toolsPassword <toolsPassword>', 'password to login to impl-tools running instance', process.env.IMPL_TOOLS_PSW)
    .option('--branchName <branchName>', 'branch name')
    .option('--buildNumber <buildNumber>', 'build number')
    .action(({fromVersion, toolsUrl, toolsUsername, toolsPassword, branchName, buildNumber}) => require('./changelog')(serviceConfig, {
        utChangelog: {fromVersion},
        utJenkins: {branchName, buildNumber},
        utBus: {
            serviceBus: {
                jsonrpc: {
                    gateway: {
                        tools: {
                            url: toolsUrl,
                            username: toolsUsername,
                            password: toolsPassword
                        }
                    }
                }
            }
        }
    }, undefined, vfs));

program
    .command('metrics')
    .description('Submit build metrics')
    .option('--toolsUrl <toolsUrl>', 'url to access impl-tools running instance', process.env.IMPL_TOOLS_URL)
    .option('--toolsUsername <toolsUsername>', 'username to login to impl-tools running instance', process.env.IMPL_TOOLS_USR)
    .option('--toolsPassword <toolsPassword>', 'password to login to impl-tools running instance', process.env.IMPL_TOOLS_PSW)
    .action(({toolsUrl, toolsUsername, toolsPassword}) => require('./metrics')(serviceConfig, {
        utBus: {
            serviceBus: {
                jsonrpc: {
                    gateway: {
                        tools: {
                            url: toolsUrl,
                            username: toolsUsername,
                            password: toolsPassword
                        }
                    }
                }
            }
        }
    }, undefined, vfs));

(async function() {
    await program.parseAsync();
})();
