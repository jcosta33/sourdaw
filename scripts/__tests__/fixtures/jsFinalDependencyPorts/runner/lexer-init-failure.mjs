import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.resolve('vitest/package.json'));
const lexer = await import(pathToFileURL(require.resolve('es-module-lexer')).href);
const original = WebAssembly.Module;
try {
    WebAssembly.Module = class {
        constructor() {
            throw new Error('WASM initialization sentinel');
        }
    };
    assert.throws(() => lexer.parse(''), /WASM initialization sentinel/);
} finally {
    WebAssembly.Module = original;
}
console.log('actual lexer parse propagates synchronous initialization failure');
