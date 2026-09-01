import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWasmDecoderModule } from '../loadWasmDecoderModule';

const loaderSource = readFileSync(
    resolve('src/modules/AudioEngine/repositories/audioDecoding/wasmDecoding/loadWasmDecoderModule.ts'),
    'utf8'
);

const wasmDecoderUrlAssignment =
    /const\s+wasmDecoderUrl\s*=\s*new URL\(\s*'wasm\/daw-wasm-decoder\/daw_wasm_decoder\.js',\s*globalThis\.location\.href\s*\)\.href/;

const viteIgnoreImport = /import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*wasmDecoderUrl\s*\)/;

describe('loadWasmDecoderModule', () => {
    it('should construct the public glue URL at runtime before importing it', () => {
        expect(loadWasmDecoderModule).toBeTypeOf('function');
        expect(loaderSource).toMatch(wasmDecoderUrlAssignment);
        expect(loaderSource).toMatch(viteIgnoreImport);
        expect(loaderSource).not.toMatch(/import\([^)]*['"`]\/(?:public\/)?wasm\//s);
    });

    it('rejects a decoy URL when wasmDecoderUrl is assigned from the wrong path', () => {
        const hybridLoaderSource = `
            new URL('wasm/daw-wasm-decoder/daw_wasm_decoder.js', globalThis.location.href).href;
            const wasmDecoderUrl = new URL('wasm/wrong.js', globalThis.location.href).href;
            return (await import(/* @vite-ignore */ wasmDecoderUrl)) as WasmDecoderModule;
        `;

        expect(hybridLoaderSource).toMatch(viteIgnoreImport);
        expect(hybridLoaderSource).not.toMatch(wasmDecoderUrlAssignment);
    });
});
