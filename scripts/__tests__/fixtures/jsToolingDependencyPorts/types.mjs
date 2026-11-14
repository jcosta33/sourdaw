import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installedGraph } from '../../../dependencyPorts/jsToolingInstalled.mjs';

const repository = resolve(process.argv[2] ?? process.cwd());
const graph = installedGraph(repository);
const context = mkdtempSync(join(repository, 'node_modules/.cache-js-tooling-types-'));
try {
    mkdirSync(join(context, 'node_modules/@types'), { recursive: true });
    symlinkSync(graph.packageRoot('@types/node', '26.6.6'), join(context, 'node_modules/@types/node'), 'junction');
    symlinkSync(graph.packageRoot('undici', '8.12.4'), join(context, 'node_modules/undici'), 'junction');
    writeFileSync(
        join(context, 'positive.mts'),
        `
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { request, ProxyAgent, type Dispatcher } from 'undici';
const signal: AbortSignal = AbortSignal.timeout(1000);
const headers: Headers = new Headers({ Accept: 'application/octet-stream' });
const requestOptions: Dispatcher.RequestOptions = { path: '/fixture', method: 'GET', signal };
const proxy = new ProxyAgent({ uri: 'http://127.0.0.1:3128', requestTls: { rejectUnauthorized: true } });
const bytes: Promise<Buffer> = readFile('fixture');
const pending = request('http://127.0.0.1', { dispatcher: proxy, signal, headers: Object.fromEntries(headers) });
const subtle = webcrypto.subtle;
void [requestOptions, bytes, pending, subtle];
`
    );
    writeFileSync(
        join(context, 'negative.mts'),
        "import type { Dispatcher } from 'undici'; const value: Dispatcher.RequestOptions = { path: '/', method: 42 }; void value;\n"
    );
    const compiler = join(graph.packageRoot('typescript', '7.0.2'), 'bin/tsc');
    const args = [
        compiler,
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'nodenext',
        '--target',
        'esnext',
        '--lib',
        'esnext,dom,dom.iterable',
        '--types',
        'node',
    ];
    const valid = spawnSync(process.execPath, [...args, 'positive.mts'], {
        cwd: context,
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    const invalid = spawnSync(process.execPath, [...args, 'negative.mts'], {
        cwd: context,
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
    assert.match(invalid.stdout, /negative\.mts.*Type 'number' is not assignable/);
    console.log('native Node and Undici strict declarations passed with rejected invalid method');
} finally {
    rmSync(context, { recursive: true, force: true });
}
