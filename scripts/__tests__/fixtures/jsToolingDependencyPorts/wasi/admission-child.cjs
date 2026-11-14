const assert = require('node:assert/strict');
const wt = require('node:worker_threads');
const RealWorker = wt.Worker;
const name = process.argv[2];
const workers = [];
const events = [];
const exits = [];
let created = 0;
const keepalive = setInterval(() => {}, 1000);
setImmediate(() => events.push('heartbeat'));
wt.Worker = class extends RealWorker {
    constructor(filename, options) {
        created++;
        if (
            (name === 'constructor-first' && created === 1) ||
            (name === 'constructor-second' && created === 2) ||
            name === 'invalid-execargv-exhausted'
        ) {
            const error = Error('deliberate-worker-startup-failure');
            if (name === 'invalid-execargv-exhausted') error.code = 'ERR_WORKER_INVALID_EXEC_ARGV';
            throw error;
        }
        if (created === 1 && name === 'worker-bootstrap-throw') {
            filename = "throw Error('deliberate-bootstrap-failure')";
            options = { ...options, eval: true, type: 'commonjs' };
        }
        if (created === 1 && name === 'worker-bootstrap-exit') {
            filename = 'process.exit(23)';
            options = { ...options, eval: true, type: 'commonjs' };
        }
        if (created === 1 && name === 'worker-missing-entry') filename = '/nonexistent-sourdaw-wasi-entry.mjs';
        if (created === 1 && name === 'genuine-worker-catch')
            filename = require('node:path').resolve('wasi-worker-genuine-catch.mjs');
        super(filename, options);
        workers.push(this);
        exits.push(
            new Promise((resolve) =>
                this.once('exit', (code) => {
                    events.push('exit:' + code);
                    resolve();
                })
            )
        );
        this.on('online', () => events.push('online'));
        this.on('message', () => events.push('message'));
        this.on('error', (error) => events.push('error:' + error.message));
    }
};
async function run() {
    let failure;
    let api;
    try {
        api = require(process.env.WASI_BINDING_ROOT);
        assert.equal(api.__napiBindingTarget, 'wasm32-wasi');
        const { rolldown } = await import(
            require('node:url').pathToFileURL(
                require('node:module').createRequire(process.env.VITE_PACKAGE).resolve('rolldown')
            ).href
        );
        const build = await rolldown({
            input: require('node:path').join(process.env.WASI_TEST_ROOT, 'life-case/a.js'),
        });
        await build.generate({ format: 'es' });
        await build.close();
        await api[Symbol.for('napi.rs.wasi.dispose')]();
    } catch (error) {
        failure = { message: error.message, cause: error.cause?.message, causeCause: error.cause?.cause?.message };
    }
    await Promise.all(exits);
    await new Promise((resolve) => setImmediate(resolve));
    const beforeRetry = created;
    let retryFailure;
    if (failure) {
        try {
            require(process.env.WASI_BINDING_ROOT);
        } catch (error) {
            retryFailure = error.message;
        }
    }
    const observation = {
        failure,
        retryFailure,
        beforeRetry,
        created,
        active: workers.filter((worker) => worker.threadId !== -1).length,
        events,
    };
    console.log('RESULT ' + JSON.stringify(observation));
    clearInterval(keepalive);
    assert(failure, 'required failure');
    assert(events.includes('heartbeat'), 'event loop must continue');
    assert.equal(observation.active, 0);
    if (name === 'constructor-second') assert.equal(workers.length, 1, 'one real worker must have been owned');
    if (name.startsWith('constructor-') || name === 'invalid-execargv-exhausted') {
        assert.equal(failure.causeCause, 'deliberate-worker-startup-failure');
        assert(retryFailure, 'same binding must not revive after failed startup');
        assert.equal(created, beforeRetry, 'rollback rejection must precede replacement workers');
    }
}
run().catch((error) => {
    clearInterval(keepalive);
    console.error(error);
    process.exitCode = 1;
});
