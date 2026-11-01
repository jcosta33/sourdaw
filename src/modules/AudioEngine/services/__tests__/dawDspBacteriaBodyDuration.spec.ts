import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BacteriaInstance, initSync } from '../../wasm/daw_dsp.js';

const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });
const BLOCK = 128;

function impulse(rate: number, body: number, frames: number): Float32Array {
    const instance = new BacteriaInstance(rate);
    try {
        for (const [name, value] of Object.entries({
            bandCount: 1,
            globalRouting: 0,
            mix: 1,
            band0_convolutionEnabled: 1,
            band0_convolutionMix: 1,
            band0_convolutionIr: body,
        })) {
            instance.set_param(name, value);
        }
        const pcm = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame += BLOCK) {
            const size = Math.min(BLOCK, frames - frame);
            const input = new Float32Array(size);
            if (frame === 0) {
                input[0] = 1;
            }
            for (const pointer of [instance.get_input_left_ptr(), instance.get_input_right_ptr()]) {
                new Float32Array(wasm.memory.buffer, pointer, size).set(input);
            }
            const pointer = instance.process(size);
            const left = new Float32Array(wasm.memory.buffer, pointer, size);
            const right = new Float32Array(wasm.memory.buffer, instance.get_right_ptr(), size);
            expect(left).toEqual(right);
            expect(left.every(Number.isFinite)).toBe(true);
            pcm.set(left, frame);
        }
        expect(instance.get_nan_flush_count()).toBe(0);
        expect(instance.get_latency_samples()).toBe(0);
        return pcm;
    } finally {
        instance.free();
    }
}

describe('checked-in Bacteria WASM body duration', () => {
    it.each([
        [176_400, 4_096],
        [192_000, 4_458],
        [384_000, 8_916],
    ])('retains the physical FIR tail at %i Hz through frame %i', (rate, end) => {
        for (const body of [0, 1, 2]) {
            const pcm = impulse(rate, body, end + BLOCK);
            expect(pcm.slice(end - 64, end).some((sample) => sample !== 0)).toBe(true);
            expect(pcm.findLastIndex((sample) => sample !== 0)).toBe(end - 1);
            expect(pcm.slice(end).every((sample) => sample === 0)).toBe(true);
            const energy = pcm.reduce((sum, sample) => sum + sample * sample, 0);
            expect(Math.abs(energy - 48_000 / rate)).toBeLessThan(1e-3);
        }
    });

    it('retains the distinct Spring tail beyond the FIR duration at 384 kHz', () => {
        const rate = 384_000;
        const pcm = impulse(rate, 3, rate * 0.2);
        const lateEnergy = pcm.slice(rate * 0.1).reduce((sum, sample) => sum + sample * sample, 0);
        // The existing native Spring oracle's 100–200 ms energy bound, scaled
        // by its physical-rate normalization. A Metal alias has no such tail.
        expect(lateEnergy).toBeGreaterThan((0.05 * 48_000) / rate);
    });
});
