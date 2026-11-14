const wt = require('node:worker_threads');
const Real = wt.Worker;
const workers = [];
const events = [];
wt.Worker = class extends Real {
    constructor(...args) {
        super(...args);
        workers.push(this);
        this.on('online', () => events.push('online'));
        this.on('message', () => events.push('message'));
        this.on('error', (e) => events.push('error:' + e.message));
        this.on('exit', (c) => events.push('exit:' + c));
    }
};
(async () => {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const api = require(process.env.WASI_BINDING_ROOT);
    assert.equal(api.__napiBindingTarget, 'wasm32-wasi');
    const { rolldown } = await import(
        require('node:url').pathToFileURL(
            require('node:module').createRequire(process.env.VITE_PACKAGE).resolve('rolldown')
        ).href
    );
    const root = path.join(process.env.WASI_TEST_ROOT, 'life-case');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(root + '/a.js', "import {x} from './b.js';export default x;\n");
    fs.writeFileSync(root + '/b.js', 'export const x=41;\n');
    let count = 0;
    for (let i = 0; i < 2; i++) {
        const b = await rolldown({
            input: root + '/a.js',
            plugins: [
                {
                    name: 'async',
                    async transform(code, id) {
                        if (id.endsWith('/b.js')) {
                            count++;
                            await new Promise((r) => setImmediate(r));
                            return code.replace('41', '42');
                        }
                        return null;
                    },
                },
            ],
        });
        const o = await b.generate({ format: 'es' });
        assert.match(o.output[0].code, /42/);
        await b.close();
    }
    assert.equal(count, 2);
    const fail = await rolldown({
        input: root + '/a.js',
        plugins: [
            {
                name: 'reject',
                async transform(code, id) {
                    if (id.endsWith('/b.js')) throw Error('fixture-plugin-failure');
                    return null;
                },
            },
        ],
    });
    await assert.rejects(fail.generate({ format: 'es' }), /fixture-plugin-failure/);
    await fail.close();
    const reused = await rolldown({
        input: root + '/a.js',
        plugins: [
            {
                name: 'after-error',
                async transform(code, id) {
                    if (id.endsWith('/b.js')) {
                        count++;
                        await new Promise((resolve) => setImmediate(resolve));
                        return code.replace('41', '44');
                    }
                    return null;
                },
            },
        ],
    });
    const recovered = await reused.generate({ format: 'es' });
    assert.match(recovered.output[0].code, /44/);
    await reused.close();
    assert.equal(count, 3);
    assert(workers.length > 0, 'actual WASI worker required');
    const dispose = api[Symbol.for('napi.rs.wasi.dispose')];
    assert.equal(typeof dispose, 'function');
    await dispose();
    assert.equal(workers.filter((w) => w.threadId !== -1).length, 0, 'worker cleanup');
    assert(events.includes('online'));
    assert(events.includes('message'));
    console.log(JSON.stringify({ created: workers.length, events, count, disposed: true }));
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
