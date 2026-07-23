import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initSync, ToasterInstance } from '../daw_dsp.js';

const FRAMES = 128;
const CHANNEL_STRIDE = 4096;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

function channelEnergy(base: number, channel: number): number {
    const samples = new Float32Array(wasm.memory.buffer, base + channel * CHANNEL_STRIDE * 4, FRAMES);
    return samples.reduce((sum, sample) => sum + Math.abs(sample), 0);
}

function renderMaster(gain: number, routed: boolean): { parent: number; pad: number } {
    const toaster = new ToasterInstance(48_000, 16);
    try {
        toaster.set_pad_dry_routed(0, routed);
        toaster.set_param_by_id(0, gain);
        toaster.note_on(0, 127, 60);
        const base = toaster.process(FRAMES);
        return {
            parent: channelEnergy(base, 0) + channelEnergy(base, 1),
            pad: channelEnergy(base, 2) + channelEnergy(base, 3),
        };
    } finally {
        toaster.free();
    }
}

function renderWet(paramId: 1 | 2, sendName: 'send_reverb' | 'send_delay', mix: number): number {
    const toaster = new ToasterInstance(48_000, 16);
    try {
        toaster.set_pad_dry_routed(0, true);
        toaster.set_pad_param(0, sendName, 1);
        toaster.set_param_by_id(paramId, mix);
        toaster.note_on(0, 127, 60);
        let energy = 0;
        const blockCount = paramId === 1 ? 40 : 150;
        for (let block = 0; block < blockCount; block++) {
            const base = toaster.process(FRAMES);
            energy += channelEnergy(base, 0) + channelEnergy(base, 1);
        }
        return energy;
    } finally {
        toaster.free();
    }
}

describe('checked-in Toaster WASM automation', () => {
    it('renders all numeric mix ids and applies master gain to routed pad taps', () => {
        expect(renderMaster(0, false)).toEqual({ parent: 0, pad: 0 });
        const audible = renderMaster(1, false);
        expect(audible.parent).toBeGreaterThan(0);
        expect(audible.pad).toBeCloseTo(audible.parent, 5);
        expect(renderMaster(0, true)).toEqual({ parent: 0, pad: 0 });
        const routed = renderMaster(1, true);
        expect(routed.parent).toBe(0);
        expect(routed.pad).toBeGreaterThan(0);
        expect(renderWet(1, 'send_reverb', 0)).toBe(0);
        expect(renderWet(1, 'send_reverb', 1)).toBeGreaterThan(0);
        expect(renderWet(2, 'send_delay', 0)).toBe(0);
        expect(renderWet(2, 'send_delay', 1)).toBeGreaterThan(0);
    });
});
