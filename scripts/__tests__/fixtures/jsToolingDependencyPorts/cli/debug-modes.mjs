import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
let req = createRequire(import.meta.resolve('dependency-cruiser'));
let debug = req.resolve('debug');
function run(extra) {
    let env = { PATH: process.env.PATH, HOME: process.env.HOME, DEBUG: 'fixture:*,-fixture:quiet', ...extra };
    let r = spawnSync(
        process.execPath,
        [
            '-e',
            `const d=require(${JSON.stringify(debug)});d('fixture:yes')('value %d',42);d('fixture:quiet')('hidden')`,
        ],
        { env, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stderr;
}
let quiet = run({ DEBUG_COLORS: 'no', FORCE_COLOR: '0' });
assert.match(quiet, /fixture:yes value 42/);
assert.doesNotMatch(quiet, /hidden|\x1b\[/);
let colored = run({ DEBUG_COLORS: 'yes', FORCE_COLOR: '3' });
assert.match(colored, /fixture:yes/);
assert.match(colored, /\x1b\[/);
assert.doesNotMatch(colored, /hidden/);
console.log('debug real stderr colored and quiet noncolor formats passed');
