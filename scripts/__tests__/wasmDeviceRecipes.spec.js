// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

import { buildDevices, QUANTUM, SAMPLE_RATE } from '../../crates/daw-dsp/benches/wasm/deviceRecipes.js';
import * as dsp from '../../public/wasm/daw-dsp/daw_dsp.js';

it('runs the real Proof benchmark with +6 dB drive and over 1 dB limiting in both windows', () => {
    const wasm = dsp.initSync({
        module: new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'))),
    });
    /** @type {import('../../public/wasm/daw-dsp/daw_dsp.js').ProofInstance | undefined} */
    let instance;
    // Capture the actual wrapper instance so the oracle can read stereo PCM
    // and public limiter telemetry; no DSP method is replaced.
    class ObservedProof extends dsp.ProofInstance {
        /** @param {number} rate */
        constructor(rate) {
            super(rate);
            expect(rate).toBe(SAMPLE_RATE);
            instance = this;
        }
    }
    const [recipe] = buildDevices({
        dsp: { ...dsp, memory: wasm.memory, ProofInstance: ObservedProof },
        only: 'proof',
    });
    expect(recipe?.id).toBe('proof');
    if (!recipe || !instance) {
        throw new Error('Proof recipe must construct its actual engine');
    }
    try {
        const audible = [false, false];
        for (let block = 0; block < 104; block++) {
            recipe.feed(block);
            const leftPtr = recipe.render(block);
            const rightPtr = instance.get_right_ptr();
            for (const [channel, ptr] of [leftPtr, rightPtr].entries()) {
                const samples = new Float32Array(wasm.memory.buffer, ptr, QUANTUM);
                expect(samples.every(Number.isFinite)).toBe(true);
                audible[channel] ||= samples.some((sample) => sample !== 0);
            }
            if (block === 39 || block === 103) {
                expect(instance.get_limiter_gr_db()).toBeLessThan(-1);
                expect(recipe.verify().ok).toBe(true);
            }
        }
        expect(audible).toEqual([true, true]);
        expect(instance.get_nan_flush_count()).toBe(0);
    } finally {
        instance.free();
    }
});
