import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initSync, TransientShaperInstance } from '../../wasm/daw_dsp.js';

initSync({
    module: new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'))),
});
describe('shipping scalar WASM ABI', () => {
    it('exports two real scalar channel paths and bounded reset', () => {
        const instance = new TransientShaperInstance(48000);
        try {
            expect(instance.process_left(0.5, 2, 0.25)).toBe(1);
            expect(instance.process_right(0.001, 2, 0.25)).toBeCloseTo(0.00025, 9);
            for (let frame = 0; frame < 48000; frame++) {
                instance.process_left(0.5, 1, 1);
            }
            expect(instance.process_left(0.5, 2, 0.25)).toBe(0.125);
            instance.reset();
            expect(instance.process_left(0.5, 2, 0.25)).toBe(1);
            expect(instance.process_left(Number.NaN, 2, 0.25)).toBe(0);
        } finally {
            instance.free();
        }
    });
    it('rejects invalid sample rates explicitly', () => {
        for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => new TransientShaperInstance(rate)).toThrow();
        }
    });
});
