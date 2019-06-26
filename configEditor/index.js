const http = require('http');
const fs = require('fs');
const path = require('path');
const html = require('./html');
module.exports = (config, schema) => {
    const editor = html(config, schema);
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(editor, 'utf-8');
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
        if (req.url.startsWith('/static')) {
            filePath = path.join(__dirname, req.url);
        } else {
            filePath = path.join(__dirname, '..', 'node_modules', req.url);
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

    server.listen(8888, () => {
        const {port} = server.address();
        // eslint-disable-next-line no-console
        console.log('\x1b[43m\x1b[30m%s\x1b[0m', ` Invalid config! Open config editor at: http://localhost:${port}/ `);
    });
};
