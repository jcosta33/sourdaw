import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedGraph } from '../../../../dependencyPorts/jsToolingInstalled.mjs';

const repository = resolve(process.cwd());
const graph = installedGraph(repository);
const privateRoot = mkdtempSync(join(tmpdir(), 'sourdaw-wasi-contract-'));
try {
    mkdirSync(join(privateRoot, 'life-case'));
    writeFileSync(join(privateRoot, 'life-case/a.js'), 'export default 42;\n');
    mkdirSync(join(privateRoot, 'node_modules'));
    symlinkSync(graph.packageRoot('tslib'), join(privateRoot, 'node_modules/tslib'), 'junction');
    const environment = {
        ...process.env,
        NAPI_RS_FORCE_WASI: 'error',
        WASI_BINDING_ROOT: graph.packageRoot('@rolldown/binding-wasm32-wasi', '1.3.2'),
        WASI_RUNTIME_ROOT: graph.packageRoot('@emnapi/runtime', '1.11.3'),
        VITE_PACKAGE: join(graph.packageRoot('vite'), 'package.json'),
        WASI_TEST_ROOT: privateRoot,
    };
    function run(file, args = [], extra = {}) {
        const result = spawnSync(process.execPath, [join(import.meta.dirname, file), ...args], {
            cwd: repository,
            env: { ...environment, ...extra },
            encoding: 'utf8',
            timeout: 15_000,
            maxBuffer: 4 * 1024 * 1024,
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null, result.stdout + result.stderr);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return result.stdout;
    }
    for (const name of ['constructor-first', 'constructor-second', 'invalid-execargv-exhausted']) {
        const output = run(
            'admission-child.cjs',
            [name],
            name === 'constructor-second' ? { TOKIO_WORKER_THREADS: '2' } : {}
        );
        const line = output.split('\n').find((value) => value.startsWith('RESULT '));
        assert(line, output);
        const observation = JSON.parse(line.slice(7));
        assert(observation.events.includes('heartbeat'));
        assert.equal(observation.active, 0);
        assert.equal(observation.failure.causeCause, 'deliberate-worker-startup-failure');
        assert.equal(observation.created, name === 'constructor-second' ? 2 : 1);
        assert.equal(observation.beforeRetry, observation.created);
        assert(observation.retryFailure);
    }
    const routes = JSON.parse(run('verify-routes.cjs').trim());
    assert.equal(routes.routes, 10);
    assert.equal(routes.passed, 10);
    const lifecycle = JSON.parse(run('reuse-after-plugin-error.cjs').trim().split('\n').at(-1));
    assert.equal(lifecycle.disposed, true);
    assert.equal(lifecycle.count, 3);
    assert.equal(lifecycle.created, 3);
    console.log('real WASI constructor rollback, ten scheduler routes and async-plugin reuse passed');
} finally {
    rmSync(privateRoot, { recursive: true, force: true });
}
