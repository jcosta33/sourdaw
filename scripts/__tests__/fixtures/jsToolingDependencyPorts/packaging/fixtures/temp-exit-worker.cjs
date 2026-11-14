const { createRequire } = require('node:module');
const r = createRequire(process.argv[2]);
const temp = r('temp');
temp.track();
const dir = temp.mkdirSync('temp-exit-');
const file = temp.openSync('temp-exit-');
require('node:fs').closeSync(file.fd);
process.stdout.write(JSON.stringify({ dir, file: file.path }) + '\n');
