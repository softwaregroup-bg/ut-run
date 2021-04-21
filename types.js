const sortKeys = require('sort-keys');
const fs = require('fs');
const {convertSchema} = require('joi-to-typescript');
const create = require('./create');
const apidoc = require('./apidoc');
const escape = string => string.replace(/\bdelete\b/g, 'delete$');
const camelCase = name => name.replace(/^([a-z]+)(\.[a-z])([a-z]+)(\.[a-z])([^.]+)$/, (match, word1, word2, word3, word4, word5) =>
    `${word1}${word2.substr(1, 1).toUpperCase()}${word3}${word4.substr(1, 1).toUpperCase()}${word5}`);

const handler = (name, int, quote = '\'') => `  ${quote}${name}${quote}: ut.remoteHandler<${escape(int)}.params, ${escape(int)}.result>`;
const handlers = name => {
    const camelCaseName = camelCase(name);
    return handler(name, name) + ((name === camelCaseName) ? '' : ',\n' + handler(camelCaseName, name, ''));
};

const error = (name, quote = '\'') => `  ${quote}${name}${quote}: ut.error`;
const errors = name => {
    name = 'error.' + name;
    const camelCaseName = camelCase(name);
    return error(name) + ((name === camelCaseName) ? '' : ',\n' + error(camelCaseName, ''));
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
    await service.create(serviceConfig, mergedConfig, assert);
    const validations = {};
    serviceBus.attachHandlers(validations, [mergedConfig.utRun.types.validation]);
    const importedErrors = {};
    serviceBus.attachHandlers(importedErrors, [mergedConfig.utRun.types.error]);
    const indent = (string, spaces = 2) => string.split('\n').join('\n' + ' '.repeat(spaces));
    const any = (string, name) => string === 'any' ? `export type ${name} = any;` : string;
    fs.writeFileSync('handlers.d.ts', '');
    Object.entries(sortKeys({...validations.imported})).forEach(([name, validation]) => {
        const schema = validation();
        const params = schema.params && convertSchema({commentEverything: false}, schema.params.label('params'));
        const result = schema.result && convertSchema({commentEverything: false}, schema.result.label('result'));
        const namespace = `declare namespace ${escape(name)} {
  ${params ? indent(any(params.content.trim(), 'params')) : ''}
  ${result ? indent(any(result.content.trim(), 'result')) : ''}
}

`;
        fs.appendFileSync('handlers.d.ts', namespace);
    });
    fs.appendFileSync('handlers.d.ts', `import ut from 'ut-run';
export interface handlers {
${Object.keys(validations.imported).sort().map(handlers).join(',\n')}
}

export interface errors {
${Object.keys(importedErrors.imported).sort().map(errors).join(',\n')}
}

${mergedConfig.utRun.types.dependencies.split(',').map(dep => dep && `import ${dep.replace(/-/g, '')} from 'ut-${dep}/handlers'
interface methods extends ${dep.replace(/-/g, '')}.handlers {}
`).join('\n')}
export type libFactory = ut.libFactory<methods, errors>
export type handlerFactory = ut.handlerFactory<methods, errors>
export type handlerSet = ut.handlerSet<methods, errors>
`);
    await apidoc(serviceBus);
    await serviceBus.stop();
};
