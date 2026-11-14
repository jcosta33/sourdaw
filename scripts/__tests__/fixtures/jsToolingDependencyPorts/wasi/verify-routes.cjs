const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = process.env.WASI_RUNTIME_ROOT;
const dist = path.join(root, 'dist');
async function check(name, runtime) {
    const oldListeners = new Set(process.listeners('beforeExit'));
    const owner = runtime.createContext();
    const other = runtime.createContext();
    owner.suppressDestroy();
    other.suppressDestroy();
    assert.notEqual(owner.feature, other.feature, name + ': context features must be isolated');
    const originalOtherScheduler = other.feature.setImmediate;
    const queued = [];
    owner.feature.setImmediate = (callback) => queued.push(callback);
    assert.equal(other.feature.setImmediate, originalOtherScheduler);
    const calls = [];
    function enqueue(context, label) {
        let resolve;
        const completed = new Promise((done) => (resolve = done));
        const environment = context.createEnv(
            name,
            8,
            (pointer) => {
                assert.equal(pointer, 91);
                return (env, data, hint) => {
                    calls.push({ label, env, data, hint });
                    resolve();
                };
            },
            () => () => {},
            (message) => {
                throw Error(message);
            }
        );
        const finalizer = context.createTrackedFinalizer(environment, 91, label === 'owner' ? 31 : 47, 59);
        environment.enqueueFinalizer(finalizer);
        return completed;
    }
    const ownerDone = enqueue(owner, 'owner');
    const otherDone = enqueue(other, 'other');
    await otherDone;
    assert.deepEqual(
        calls.map((call) => call.label),
        ['other']
    );
    assert.equal(queued.length, 1, name + ': own finalizer must use own scheduler');
    queued.shift()();
    await ownerDone;
    assert.deepEqual(
        calls.map((call) => [call.label, call.data, call.hint]),
        [
            ['other', 47, 59],
            ['owner', 31, 59],
        ]
    );
    owner.destroy();
    other.destroy();
    for (const listener of process.listeners('beforeExit'))
        if (!oldListeners.has(listener)) process.removeListener('beforeExit', listener);
    return { name, defaultFinalizer: true, ownScheduler: true, isolatedContexts: true };
}
function browserRuntime(filename) {
    const context = vm.createContext({
        setImmediate,
        clearImmediate,
        setTimeout,
        clearTimeout,
        console,
        Buffer,
        FinalizationRegistry,
        WeakRef,
    });
    vm.runInContext(fs.readFileSync(path.join(dist, filename), 'utf8'), context, { filename });
    return context.emnapi;
}
(async () => {
    const results = [];
    for (const filename of ['emnapi.cjs.js', 'emnapi.cjs.min.js', 'emnapi.js', 'emnapi.min.js'])
        results.push(await check(filename + ':require', require(path.join(dist, filename))));
    for (const filename of ['emnapi.mjs', 'emnapi.min.mjs'])
        results.push(await check(filename, await import(pathToFileURL(path.join(dist, filename)).href)));
    const bundledPath = path.join(process.env.WASI_TEST_ROOT, 'exact-esm-bundler.mjs');
    fs.copyFileSync(path.join(dist, 'emnapi.esm-bundler.js'), bundledPath);
    results.push(
        await check('emnapi.esm-bundler.js:exact-module-bytes', await import(pathToFileURL(bundledPath).href))
    );
    for (const filename of ['emnapi.iife.js', 'emnapi.js', 'emnapi.min.js'])
        results.push(await check(filename + ':browser-vm', browserRuntime(filename)));
    console.log(JSON.stringify({ routes: results.length, passed: results.length, results }));
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
