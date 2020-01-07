const create = require('./create');
const parse = require('json-schema-to-markdown');
const fs = require('fs');
const path = require('path');
module.exports = async function doc(serviceConfig) {
    const {service} = await create({
        implementation: 'doc',
        utBus: { serviceBus: { jsonrpc: true } }
    });
    const [port] = await service.create([() => ({doc: [serviceConfig]})]);
    const md = parse(port.configSchema);
    fs.writeFileSync(path.join(process.cwd(), 'config.md'), md);
    process.exit(0); // eslint-disable-line no-process-exit
};
