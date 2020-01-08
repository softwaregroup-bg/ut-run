require('../doc')(require(process.cwd()))
    .catch(e => {
        console.error(e); // eslint-disable-line no-console
        process.exit(1); // eslint-disable-line no-process-exit
    });
