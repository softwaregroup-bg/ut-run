const sortKeys = require('sort-keys');
const fs = require('fs');
const {convertSchema} = require('joi-to-typescript');
const create = require('./create');
const apidoc = require('./apidoc');
const escape = string => string.replace(/\bdelete\b/g, 'delete$').replace(/\breturn\b/g, 'return$').replace(/\//g, '$').replace(/\./g, '_');
const camelCase = name => name.replace(/^([a-z/]+)(\.[a-z])([a-z]+)(\.[a-z])([^.]+)$/, (match, word1, word2, word3, word4, word5) =>
    `${word1.replace(/\//g, '$')}${word2.substr(1, 1).toUpperCase()}${word3}${word4.substr(1, 1).toUpperCase()}${word5}`);

const handler = (name, int, quote = '\'') => `  ${quote}${name}${quote}?: ut.handler<${escape(int)}.params, ${escape(int)}.result, location>`;
const handlers = name => {
    const camelCaseName = camelCase(name);
    return handler(name, name) + ((name === camelCaseName) ? '' : ',\n' + handler(camelCaseName, name, ''));
};

const error = (name, params, quote = '\'') => `  ${quote}${name}${quote}: ut.error${params?.length ? `Param<{ ${params.map(param => `${param}: string | number`).join(', ')} }>` : ''}`;
const errors = ([name, err]) => {
    name = 'error.' + name;
    const camelCaseName = camelCase(name);
    return error(name, err.params) + ((name === camelCaseName) ? '' : ',\n' + error(camelCaseName, err.params, ''));
};

module.exports = async function types(serviceConfig, envConfig, assert, vfs) {
    const {
        service,
        serviceBus,
        mergedConfig
    } = await create({
        implementation: 'doc',
        repl: false,
        log: false,
        utLog: {
            streams: {
                udp: false
            }
        },
        utBus: {
            serviceBus: {
                jsonrpc: {
                    utLogin: false
                }
            }
        },
        configFilenames: ['common', 'types'],
        ...envConfig
    }, vfs);
    const ports = await service.create(serviceConfig, mergedConfig, assert);
    const validations = {};
    serviceBus.attachHandlers(validations, [mergedConfig.utRun.types.validation]);
    const importedErrors = {};
    serviceBus.attachHandlers(importedErrors, [mergedConfig.utRun.types.error]);
    const indent = (string, spaces = 2) => string.split('\n').join('\n' + ' '.repeat(spaces));
    const any = (string, name) => string === 'any' ? `export type ${name} = any;` : string;
    const portMethods = {};
    for (const port of ports) {
        Object.assign(portMethods, await port?.types?.());
    }
    fs.writeFileSync('handlers.d.ts', `declare namespace ${mergedConfig.utRun.types.validation.match(/^ut(.*)\./)[1].toLowerCase()}TableTypes {}\n`);
    Object.entries(sortKeys({...portMethods, ...validations.imported})).forEach(([name, validation]) => {
        const schema = validation();
        const params = schema?.params?.meta && convertSchema({commentEverything: false}, schema.params.meta({className: 'params'}), undefined, true);
        const result = schema?.result?.meta && convertSchema({commentEverything: false}, schema.result.meta({className: 'result'}), undefined, true);
        const namespace = `declare namespace ${schema.name || escape(name)} {
  ${params ? indent(any(params.content.trim(), 'params')) : ''}
  ${result ? indent(any(result.content.trim(), 'result')) : ''}
}

`;
        fs.appendFileSync('handlers.d.ts', namespace);
    });
    fs.appendFileSync('handlers.d.ts', `import ut from 'ut-run';
export interface ports<location = ''> {
${Object.entries(portMethods).map(([name, validation]) => !validation?.()?.private && name).filter(Boolean).sort().map(handlers).join(',\n')}
}
interface methods extends ports {}

export interface handlers<location = ''> {
${Object.keys(validations.imported).sort().map(handlers).join(',\n')}
}

export interface errors {
${Object.entries(sortKeys({...importedErrors.imported})).map(errors).join(',\n')}
}

${mergedConfig.utRun.types.dependencies.split(',').map(dep => dep && `import ${dep.replace(/-/g, '')}, {${dep.replace(/-/g, '')}TableTypes} from 'ut-${dep}/handlers'
interface methods extends ${dep.replace(/-/g, '')}.handlers {}
`).join('\n')}
export type libFactory = ut.libFactory<methods, errors>
export type handlerFactory = ut.handlerFactory<methods, errors, handlers<'local'>>
export type handlerSet = ut.handlerSet<methods, errors, handlers<'local'>>

import portal from 'ut-portal'
export type pageFactory = portal.pageFactory<methods, errors>
export type pageSet = portal.pageSet<methods, errors>
`);
    await apidoc(serviceBus);
    await serviceBus.stop();
};
