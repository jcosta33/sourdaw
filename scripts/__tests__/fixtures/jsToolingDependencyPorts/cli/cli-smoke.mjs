import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(import.meta.resolve('dependency-cruiser')).replace(
    /src\/main\/index\.mjs$/,
    'bin/dependency-cruiser.mjs'
);
const home = mkdtempSync(join(tmpdir(), 'sdaw-cli-'));
let env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, FAKEROOTKEY: '1', NO_COLOR: '1' };
function run(args) {
    let r = spawnSync(process.execPath, [entry, ...args], { env, cwd: home, encoding: 'utf8' });
    assert.ifError(r.error);
    return r;
}
let help = run(['--help']);
assert.equal(help.status, 0);
assert.match(help.stdout, /Validate and visualize dependencies/);
let version = run(['--version']);
assert.equal(version.status, 0);
assert.match(version.stdout, /18\.7\.2/);
let bad = run(['--definitely-invalid-option']);
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /unknown option/);
writeFileSync(join(home, 'entry.js'), 'export const value = 42;\n');
let cruise = run(['--no-config', '--output-type', 'json', 'entry.js']);
assert.equal(cruise.status, 0, cruise.stderr);
let graph = JSON.parse(cruise.stdout);
assert.ok(graph.modules.some((x) => x.source === 'entry.js'));
console.log('CLI help, version, invalid option and local JSON graph passed');
