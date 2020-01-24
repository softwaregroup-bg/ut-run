#!/usr/bin/env node

const vfs = require('./vfs');
require('../doc')(require(process.cwd()), undefined, undefined, vfs)
    .catch(e => {
        console.error(e); // eslint-disable-line no-console
        process.exit(1); // eslint-disable-line no-process-exit
    });
