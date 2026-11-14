import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const home = mkdtempSync(join(tmpdir(), 'sdaw-prefix-'));
const consumer = fileURLToPath(import.meta.resolve('dependency-cruiser'));
const child = fileURLToPath(new URL('./global-directory-child.mjs', import.meta.url));
const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, FAKEROOTKEY: '1' };
function run(extra = {}) {
    let r = spawnSync(process.execPath, [child, consumer], { env: { ...env, ...extra }, cwd: home, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}
writeFileSync(join(home, '.npmrc'), 'prefix="~/some path"\n');
assert.equal(run().npm.prefix, join(home, 'some path'));
assert.equal(run({ npm_config_prefix: '' }).npm.prefix, join(home, 'some path'));
assert.equal(
    run({ NPM_CONFIG_PREFIX: join(home, 'env'), PREFIX: join(home, 'fallback') }).npm.prefix,
    join(home, 'env')
);
assert.equal(run({ PREFIX: join(home, 'fallback') }).npm.prefix, join(home, 'some path'));
let value = run({ PNPM_HOME: join(home, 'pnpm-home'), XDG_DATA_HOME: join(home, 'data') });
assert.equal(value.yarn.prefix, join(home, 'data/yarn'));
assert.equal(value.pnpm.prefix, join(home, 'pnpm-home'));
assert.equal(value.pnpm.packages, join(home, 'pnpm-home/global/5/node_modules'));
assert.equal(value.globally, false);
console.log('seven private POSIX prefix, precedence, yarn, pnpm and local-install assertions passed');
