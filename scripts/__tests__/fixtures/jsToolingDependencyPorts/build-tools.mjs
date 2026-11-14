import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { build } from 'vite';

const repository = process.cwd();
const knipRequire = createRequire(import.meta.resolve('knip'));
const { parseSync } = knipRequire('oxc-parser');
const context = mkdtempSync(join(tmpdir(), 'sourdaw-js-tooling-build-'));
try {
    symlinkSync(join(repository, 'node_modules'), join(context, 'node_modules'), 'junction');
    const root = join(context, 'vite-case');
    mkdirSync(root);
    const files = {
        'index.html': '<div id="root"></div><script type="module" src="/entry.tsx"></script>',
        'entry.tsx': `import { useState, useEffect } from 'react'; import { createRoot } from 'react-dom/client';
import asset from './asset.txt?url'; import './base.css';
function Display({message}: {message: string}) { return <strong>{message.toUpperCase()}</strong> }
function App() { const [message, setMessage] = useState('loading'); useEffect(() => {
Promise.all([import('./a'), import('./b')]).then(([a,b]) => setMessage(a.value + b.value));
const worker = new Worker(new URL('./worker.ts', import.meta.url), {type:'module'});
worker.onmessage = event => document.body.dataset.worker = event.data; return () => worker.terminate();
}, []); return <main data-asset={asset}>{message}<Display message={message}/></main> }
createRoot(document.getElementById('root')!).render(<App/>);`,
        'a.ts': "import './a.css'; export const value: string = 'lazy-a';",
        'b.ts': "import './b.css'; export const value: string = 'lazy-b';",
        'base.css': 'main { color: black }',
        'a.css': '.fixture-a { color: red }',
        'b.css': '.fixture-b { color: blue }',
        'worker.ts': "self.postMessage('worker-ready');",
        'asset.txt': 'asset fixture bytes',
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    await build({
        configFile: false,
        root,
        logLevel: 'error',
        plugins: [babel({ presets: [reactCompilerPreset()] }), react()],
        worker: { format: 'iife' },
        build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, minify: false, assetsInlineLimit: 0 },
    });
    const assets = join(root, 'dist/assets');
    const emitted = readdirSync(assets);
    const scripts = emitted
        .filter((name) => name.endsWith('.js'))
        .map((name) => readFileSync(join(assets, name), 'utf8'));
    assert(scripts.some((text) => text.includes('lazy-a')));
    assert(scripts.some((text) => text.includes('lazy-b')));
    assert(scripts.some((text) => text.includes('worker-ready')));
    assert(
        scripts.some((text) => text.includes('react/compiler-runtime')) ||
            scripts.some((text) => text.includes('memo_cache_sentinel'))
    );
    for (const text of scripts) {
        assert.doesNotMatch(text, /__VITE_PRELOAD__[a-f0-9]*/);
        assert.equal(
            parseSync('emitted.js', text, { sourceType: 'module' }).errors.length,
            0,
            'actual preload output must parse'
        );
    }
    assert(emitted.some((name) => name.endsWith('.map')));
    assert(emitted.filter((name) => name.endsWith('.css')).length >= 3);
    const assetName = emitted.find((name) => name.endsWith('.txt'));
    assert(assetName);
    assert.equal(readFileSync(join(assets, assetName), 'utf8'), 'asset fixture bytes');

    const knipCase = join(context, 'knip-case');
    cpSync(join(import.meta.dirname, 'knip-case'), knipCase, { recursive: true });
    const entry = join(dirname(fileURLToPath(import.meta.resolve('knip'))), '../bin/knip.js');
    const reports = [];
    for (const rawTransfer of ['0', '1']) {
        const result = spawnSync(
            process.execPath,
            [
                entry,
                '--directory',
                knipCase,
                '--include',
                'files,exports',
                '--reporter',
                'json',
                '--no-progress',
                '--no-config-hints',
            ],
            {
                cwd: repository,
                env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: rawTransfer },
                encoding: 'utf8',
                timeout: 20_000,
            }
        );
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stderr);
        const report = JSON.parse(result.stdout);
        const text = JSON.stringify(report);
        assert.match(text, /orphan\.ts/);
        assert.match(text, /unusedName/);
        assert.doesNotMatch(text, /lazy\.ts|worker\.ts|"name":"default"/);
        reports.push(report);
    }
    assert.deepEqual(reports[0], reports[1]);
    const syntax = parseSync('bad.ts', 'export const broken: = ;', { sourceType: 'module' });
    assert(syntax.errors.length > 0);
    console.log('actual Vite compiler chunks, worker, asset, maps and Knip OXC enumeration passed');
} finally {
    rmSync(context, { recursive: true, force: true });
}
