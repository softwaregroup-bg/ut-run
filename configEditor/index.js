const http = require('http');
const fs = require('fs');
const path = require('path');
const html = require('./html');
const yaml = require('yaml');
const {strOptions} = require('yaml/types');
const jsoneditorPath = path.dirname(require.resolve('jsoneditor/package.json'));

module.exports = (config, schema, service) => {
    const editor = html(config, schema);
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(editor, 'utf-8');
        }

        if (req.url === '/k8s.yaml') {
            let layers = config && config.run && config.run.layers;
            if (!service) {
                res.writeHead(404);
                res.end('Ports not created, run with UT_METHOD=kustomize', 'utf-8');
            };
            if (!layers) {
                res.writeHead(404);
                res.end('Missing configuration run.layers', 'utf-8');
            };
            res.writeHead(200, {'Content-Type': 'application/x-yaml'});
            let result = service.kustomize({layers, config});

            let lineWidth = strOptions.fold.lineWidth; // yet another stupid singleton
            try {
                strOptions.fold.lineWidth = 1e6;
                result = [
                    result.namespace,
                    ...Object.values(result.secrets),
                    ...Object.values(result.deployments),
                    ...Object.values(result.services),
                    ...Object.values(result.ingresses)
                ].map(item => yaml.stringify(item));
            } finally {
                strOptions.fold.lineWidth = lineWidth;
            }
            return res.end(result.join('---\n'), 'utf-8');
        }

        let contentType;

        switch (path.extname(req.url)) {
            case '.js':
                contentType = 'text/javascript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.svg':
                contentType = 'image/svg+xml';
                break;
            default:
                contentType = 'text/html';
                break;
        }

        let filePath;
        if (req.url.startsWith('/static/')) {
            filePath = path.join(__dirname, req.url);
        } else if (req.url.startsWith('/jsoneditor/')) {
            filePath = path.join(jsoneditorPath, req.url.substr(12));
        } else {
            res.writeHead(404);
            res.end('Not found', 'utf-8');
            return;
        }

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('Not found', 'utf-8');
                } else {
                    res.writeHead(500);
                    res.end('Internal server error: ' + error.code + ' ..\n');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });

    server.listen(() => {
        const {port} = server.address();
        // eslint-disable-next-line no-console
        console.log(
            '\x1b[43m\x1b[30m%s\n%s\x1b[0m',
            ` Invalid config! Open config editor at: http://localhost:${port}/    `,
            ` Run in k8s with: kubectl apply -f http://localhost:${port}/k8s.yaml `
        );
    });

    return new Promise((resolve, reject) => {
        server.on('close', resolve);
        server.on('error', reject);
    });
};
