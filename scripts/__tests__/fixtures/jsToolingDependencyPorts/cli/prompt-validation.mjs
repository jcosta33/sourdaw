import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
const req = createRequire(import.meta.resolve('dependency-cruiser'));
const prompts = req('prompts');
let input = new PassThrough(),
    output = '';
let resolveError;
const errorSeen = new Promise((r) => (resolveError = r));
let out = new Writable({
    write(chunk, enc, done) {
        output += chunk.toString();
        if (output.includes('Too short')) resolveError();
        done();
    },
});
out.columns = 80;
let pending = prompts.prompts.text({
    message: 'Name',
    stdin: input,
    stdout: out,
    validate: (v) => v.length >= 2 || 'Too short',
});
input.emit('keypress', 'a', { name: 'a' });
input.emit('keypress', '\r', { name: 'return' });
await errorSeen;
assert.match(output, /Too short/);
input.emit('keypress', 'b', { name: 'b' });
input.emit('keypress', '\r', { name: 'return' });
assert.equal(await pending, 'ab');
assert.equal(input.listenerCount('keypress'), 0);
assert.match(output, /\x1b\[\?25h/);
let submits = [];
prompts.inject(['value']);
let result = await prompts(
    { type: 'text', name: 'n', message: 'Input' },
    { onSubmit: (q, v) => submits.push([q.name, v]) }
);
assert.deepEqual(result, { n: 'value' });
assert.deepEqual(submits, [['n', 'value']]);
let cancelled = [];
prompts.inject([new Error('cancel')]);
let empty = await prompts(
    { type: 'text', name: 'n', message: 'Input' },
    {
        onCancel: (q) => {
            cancelled.push(q.name);
            return false;
        },
    }
);
assert.deepEqual(empty, {});
assert.deepEqual(cancelled, ['n']);
await assert.rejects(
    prompts({ type: 'missing', name: 'n', message: 'Input' }),
    /prompt type \(missing\) is not defined/
);
console.log('validation retry, injected submit/cancel and invalid type passed');
