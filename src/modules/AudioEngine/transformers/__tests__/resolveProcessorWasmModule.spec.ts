import { describe, expect, it } from 'vitest';

import { resolveProcessorWasmModule } from '../resolveProcessorWasmModule';

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('resolveProcessorWasmModule', () => {
    it('returns the compiled module supplied in processor options', () => {
        const wasmModule = new WebAssembly.Module(MINIMAL_WASM);

        expect(resolveProcessorWasmModule({ processorOptions: { wasmModule } })).toBe(wasmModule);
    });

    it('rejects the former byte payload instead of compiling on the worklet thread', () => {
        expect(resolveProcessorWasmModule({ processorOptions: { wasmModule: MINIMAL_WASM } })).toBeNull();
    });

    it.each([undefined, null, {}, { processorOptions: null }])(
        'rejects malformed constructor options: %j',
        (options) => {
            expect(resolveProcessorWasmModule(options)).toBeNull();
        }
    );
});
