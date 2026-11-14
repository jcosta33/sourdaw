const { createRequire } = require('node:module');
const Module = require('node:module');
const [cli, args] = process.argv.slice(2);
const r = createRequire(cli);
const api = r('./api.js');
api.inject = async (file, name, data, options) => {
    process.stdout.write('POSTJECT_ARGS:' + JSON.stringify({ file, name, bytes: [...data], options }) + '\n');
};
process.argv = [process.execPath, cli, ...JSON.parse(args)];
Module._load(cli, null, true);
