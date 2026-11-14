const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once, getEventListeners } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const app = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const unzip = createRequire(app.resolve('unzipper'));
const duplex = createRequire(unzip.resolve('duplexer2'));
const stream = duplex('readable-stream');
const root = path.dirname(duplex.resolve('readable-stream/package.json'));
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
test('published native abort bindings and browser mapping retain actual standard globals with explicit Node floor', () => {
    const native = require(path.join(root, 'lib/ours/abort'));
    assert.equal(native.AbortController, globalThis.AbortController);
    assert.equal(native.AbortSignal, globalThis.AbortSignal);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    assert.equal(manifest.engines.node, '>=26');
    assert.equal('abort-controller' in manifest.dependencies, false);
    assert.equal(typeof require(path.join(root, 'lib/ours/browser')).Readable, 'function');
    for (const file of [
        'lib/ours/util.js',
        'lib/internal/streams/duplexify.js',
        'lib/internal/streams/operators.js',
        'lib/internal/streams/pipeline.js',
    ])
        assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /require\(['"]abort-controller/);
});
for (const entry of [
    'lib/ours/util.js',
    'lib/internal/streams/duplexify.js',
    'lib/internal/streams/operators.js',
    'lib/internal/streams/pipeline.js',
    'lib/ours/index.js',
    'lib/ours/browser.js',
])
    for (const missing of ['AbortController', 'AbortSignal'])
        test('missing ' + missing + ' refuses ' + entry, () => {
            const child = spawnSync(
                process.execPath,
                [path.join(__dirname, '../fixtures/native-abort-worker.cjs'), root, entry, missing],
                { encoding: 'utf8', timeout: 5000, env: process.env }
            );
            assert.equal(child.error, undefined);
            assert.equal(child.status, 0, child.stderr);
            assert.match(child.stdout, /MISSING_NATIVE_REFUSED/);
        });
test('native signal destroys actual custom stream with AbortError cause and clears listener', async () => {
    const controller = new AbortController(),
        cause = new Error('native cancellation');
    const input = new stream.Readable({ read() {}, signal: controller.signal });
    const error = once(input, 'error');
    const closed = new Promise((resolve) => input.once('close', resolve));
    controller.abort(cause);
    const [observed] = await error;
    await closed;
    assert.equal(observed.name, 'AbortError');
    assert.equal(observed.cause, cause);
    assert.equal(input.destroyed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test(
    'actual pipeline cancellation preserves AbortError and closes both streams before completion',
    { timeout: 5000 },
    async () => {
        const controller = new AbortController(),
            cause = new Error('pipeline cancellation'),
            started = deferred();
        const input = new stream.Readable({ read() {} }),
            output = new stream.Writable({
                write(chunk, enc, done) {
                    started.resolve();
                    done();
                },
            });
        const operation = stream.promises.pipeline(input, output, {
            signal: controller.signal,
        });
        const rejection = assert.rejects(operation, (e) => e.name === 'AbortError' && e.cause === undefined);
        input.push(Buffer.from('known'));
        await started.promise;
        controller.abort(cause);
        await rejection;
        assert.equal(input.destroyed, true);
        assert.equal(output.destroyed, true);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
);
test('actual map operator cancels native internal signal and releases caller listener', { timeout: 5000 }, async () => {
    const controller = new AbortController(),
        started = deferred();
    let inner;
    const input = stream.Readable.from([1, 2, 3]);
    const mapped = input.map(
        async (value, { signal }) => {
            inner = signal;
            started.resolve();
            await new Promise((resolve, reject) =>
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                })
            );
            return value;
        },
        { signal: controller.signal }
    );
    const reason = new Error('operator cancellation');
    const pending = mapped.toArray();
    const rejection = assert.rejects(pending, (e) => e === reason);
    await started.promise;
    assert.ok(inner instanceof AbortSignal);
    controller.abort(reason);
    await rejection;
    assert.equal(inner.aborted, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test(
    'actual Duplex.from async generator receives native cancellation while preserving stream error',
    { timeout: 5000 },
    async () => {
        let signal;
        const completed = deferred();
        const value = stream.Duplex.from(async function (source, options) {
            signal = options.signal;
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            completed.resolve();
        });
        assert.ok(signal instanceof AbortSignal);
        const expected = new Error('duplex boundary failure'),
            error = once(value, 'error'),
            closed = new Promise((resolve) => value.once('close', resolve));
        value.destroy(expected);
        assert.equal((await error)[0], expected);
        await closed;
        await completed.promise;
        assert.equal(signal.aborted, true);
    }
);
