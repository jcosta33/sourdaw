import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
const req = createRequire(import.meta.resolve('dependency-cruiser'));
const prompts = req('prompts');
let input = new PassThrough(),
    chunks = [];
let out = new Writable({
    write(c, e, d) {
        chunks.push(c.toString());
        d();
    },
});
out.columns = 8;
let p = prompts.prompts.text({ message: '界界界', stdin: input, stdout: out });
let initial = chunks.join('');
chunks = [];
input.emit('keypress', 'a', { name: 'a' });
let after = chunks.join('');
chunks = [];
input.emit('keypress', '\r', { name: 'return' });
let value = await p;
let final = chunks.join('');
assert.match(initial, /\? 界界界 ›/);
assert.ok(after.startsWith('\x1b[2K\x1b[1A\x1b[2K\x1b[G'));
assert.match(final, /✔ 界界界 … a/);
assert.match(final, /\x1b\[\?25h/);
assert.equal(value, 'a');
assert.equal(input.listenerCount('keypress'), 0);
console.log('narrow real prompt clear, submit and cleanup passed');
