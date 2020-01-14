const create = require('./create');
const fs = require('fs');
const path = require('path');
module.exports = async function doc(serviceConfig) {
    const {service, serviceBus} = await create({
        implementation: 'doc',
        repl: false,
        utLog: { streams: { udp: false } },
        utBus: { serviceBus: { jsonrpc: true } }
    });
    const [port] = await service.create([() => ({doc: [serviceConfig]})]);
    const md = require('json-schema-to-markdown')({title: 'Configuration', ...port.configSchema});
    fs.writeFileSync(path.join(process.cwd(), 'config.md'), md + '\n');
    await serviceBus.stop();
};
