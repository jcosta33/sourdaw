'use strict';
const { createRequire } = require('node:module');
const laneRequire = require('./installed-require.cjs').packageRequire;
const appRequire = createRequire(laneRequire.resolve('app-builder-lib/package.json'));
const lockfile = appRequire('proper-lockfile');
lockfile
    .lock(process.argv[2], { retries: 0 })
    .then(() => {
        process.stdout.write('LOCK_ACQUIRED\n');
        process.exit(0);
    })
    .catch((error) => {
        process.stderr.write(error.stack + '\n');
        process.exitCode = 1;
    });
