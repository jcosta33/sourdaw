import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { installedGraph } from '../../../../dependencyPorts/jsToolingInstalled.mjs';
const graph = installedGraph(process.cwd()),
    actual = graph.packageRoot('vitest'),
    root = mkdtempSync(join(tmpdir(), 'sourdaw-lexer-async-'));
try {
    cpSync(actual, join(root, 'vitest'), {
        recursive: true,
        filter: (p) => p === actual || !p.startsWith(join(actual, 'node_modules')),
    });
    const copy = join(root, 'vitest');
    symlinkSync(dirname(actual), join(copy, 'node_modules'), 'junction');
    const file = join(copy, 'dist/chunks/index.Di8au7q4.js'),
        original = readFileSync(file, 'utf8');
    assert.equal(original.includes('export { isValidNodeImport, detectModuleType };'), false);
    writeFileSync(file, original + '\nexport { isValidNodeImport, detectModuleType };\n');
    const api = await import(pathToFileURL(file));
    const compile = WebAssembly.compile;
    let calls = 0;
    try {
        WebAssembly.compile = function (...args) {
            calls++;
            return compile.apply(this, args);
        };
        if (process.argv[2] === 'detectModuleType')
            assert.equal(
                await api.detectModuleType(null, '__vite_ssr_exportName__ module', async () => 'module.exports=3'),
                'cjs'
            );
        else assert.equal(await api.isValidNodeImport(join(import.meta.dirname, 'modules/cjs.js')), true);
        assert.equal(calls, 1, 'actual async consumer must initialize real lexer');
    } finally {
        WebAssembly.compile = compile;
    }
    console.log(process.argv[2] + ' initializes real lexer asynchronously');
} finally {
    rmSync(root, { recursive: true, force: true });
}
