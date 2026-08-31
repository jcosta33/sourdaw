import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadWasmDecoderModule } from '../loadWasmDecoderModule';

const loaderSource = readFileSync(
    resolve('src/modules/AudioEngine/repositories/audioDecoding/wasmDecoding/loadWasmDecoderModule.ts'),
    'utf8'
);

describe('loadWasmDecoderModule', () => {
    it('should construct the public glue URL at runtime before importing it', () => {
        expect(loadWasmDecoderModule).toBeTypeOf('function');
        expect(loaderSource).toMatch(
            /new URL\(\s*'wasm\/daw-wasm-decoder\/daw_wasm_decoder\.js',\s*globalThis\.location\.href\s*\)\.href/
        );
        expect(loaderSource).toMatch(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*wasmDecoderUrl\s*\)/);
        expect(loaderSource).not.toMatch(/import\([^)]*['"`]\/(?:public\/)?wasm\//s);
    });
});
