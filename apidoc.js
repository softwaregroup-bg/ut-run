const got = require('got');
const stream = require('readable-stream');
const {promisify} = require('util');
const fs = require('fs');
const fsplus = require('fs-plus');
const path = require('path');
const pipeline = promisify(stream.pipeline);

// tiny spider
async function crawl(root, page, visited) {
    const {body, url} = await got(page);
    const ref = /(href|src)="[^"]+"/g;
    const basename = (x => x.substr(0, x.length - 1))(path.basename(url + '#'));
    const index = path.resolve('.lint', 'doc', path.relative(root, path.dirname(url + '#')), basename || 'index.html');
    fsplus.makeTreeSync(path.dirname(index));
    fs.writeFileSync(index, body);

    for (const href of body.match(ref)) {
        const rel = href.split('"')[1];
        try {
            // eslint-disable-next-line no-new
            new URL(rel);
            continue; // skip absolute URLs
        } catch {
            const resource = new URL(rel, url);
            if (!visited.includes(resource.href)) {
                const filename = path.resolve('.lint', 'doc' + resource.pathname);
                fsplus.makeTreeSync(path.dirname(filename));
                let type;
                await pipeline(got.stream(resource).on('response', response => {
                    type = response.headers['content-type'];
                }), fs.createWriteStream(filename));
                visited.push(resource.href);
                if (type.startsWith('text/html')) await crawl(root, resource, visited);
            }
        }
    }
}

module.exports = async function apidoc(serviceBus) {
    await serviceBus.publicApi.ready();
    const root = serviceBus.publicApi.info().uri;
    await crawl(root, new URL('api', root).href, []);
};
