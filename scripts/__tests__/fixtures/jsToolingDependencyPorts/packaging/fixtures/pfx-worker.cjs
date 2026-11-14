'use strict';
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');
const blocked = [];
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'])
    childProcess[method] = () => {
        blocked.push(method);
        throw new Error('PFX_FIXTURE_FORBIDDEN_PROCESS');
    };
for (const name of ['node:http', 'node:https']) {
    const http = require(name);
    for (const method of ['request', 'get'])
        http[method] = () => {
            blocked.push(name + '.' + method);
            throw new Error('PFX_FIXTURE_FORBIDDEN_NETWORK');
        };
}
globalThis.fetch = async () => {
    blocked.push('fetch');
    throw new Error('PFX_FIXTURE_FORBIDDEN_NETWORK');
};
Module.syncBuiltinESMExports();
const [appRoot, file, password] = process.argv.slice(2);
async function main() {
    try {
        const subject = require(path.join(appRoot, 'out/codeSign/certInfo.js'));
        const value = await subject.readCertInfo(file, password);
        process.stdout.write('PFX_FIXTURE:' + JSON.stringify({ ok: true, value, blocked }) + '\n');
    } catch (error) {
        process.stdout.write(
            'PFX_FIXTURE:' +
                JSON.stringify({
                    ok: false,
                    error: { name: error.name, message: error.message },
                    blocked,
                }) +
                '\n'
        );
    }
}
main().catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 90;
});
