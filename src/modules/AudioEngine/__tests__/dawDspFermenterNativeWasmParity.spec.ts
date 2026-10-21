import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

import { FermenterInstance, initSync } from '../wasm/daw_dsp.js';

const FRAMES_PER_BLOCK = 128;
const BLOCKS = 40;
const FRAMES = FRAMES_PER_BLOCK * BLOCKS;
const SENTINEL = 'FERMENTER_NATIVE_WASM_PARITY_JSON:';

type StereoRender = { framesPerChannel: number; left: number[]; right: number[] };

function checkedRender(value: unknown, target: string): StereoRender {
    if (typeof value !== 'object' || value === null || !('framesPerChannel' in value)) {
        throw new Error(`${target}: missing frame count`);
    }
    const render = value as Record<string, unknown>;
    if (render.framesPerChannel !== FRAMES) {
        throw new Error(`${target}: expected ${FRAMES} frames per channel, got ${render.framesPerChannel}`);
    }
    for (const channel of ['left', 'right'] as const) {
        const samples = render[channel];
        if (!Array.isArray(samples) || samples.length !== FRAMES || !samples.every(Number.isFinite)) {
            throw new Error(`${target}: ${channel} must contain ${FRAMES} finite samples`);
        }
    }
    return {
        framesPerChannel: FRAMES,
        left: render.left as number[],
        right: render.right as number[],
    };
}

function nativeRender(): StereoRender {
    const run = spawnSync(
        'cargo',
        [
            'test',
            '--package',
            'daw-dsp',
            '--test',
            'fermenter_native_wasm_parity',
            'native_fermenter_render_for_wasm_parity',
            '--',
            '--exact',
            '--nocapture',
        ],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 }
    );
    if (run.error || run.status !== 0) {
        throw new Error(`native Fermenter render failed (${run.signal ?? run.status}): ${run.error ?? run.stderr}`);
    }
    const payloads = run.stdout.split(/\r?\n/).filter((line) => line.startsWith(SENTINEL));
    if (payloads.length !== 1) {
        throw new Error(`native Fermenter render emitted ${payloads.length} parity payloads; expected one`);
    }
    return checkedRender(JSON.parse(payloads[0]!.slice(SENTINEL.length)), 'native');
}

function wasmRender(): StereoRender {
    const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
    const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });
    const instance = new FermenterInstance(48_000, 8);
    try {
        // These f32 values and the event boundaries exactly match the native
        // fixture; keep both copies in lockstep when changing the stimulus.
        for (const [name, value] of [
            ['engine', 0],
            ['osc_waveform', 0],
            ['osc_level', 0.75],
            ['layer_pan', -0.5],
            ['amp_attack', 0.001],
            ['amp_decay', 0.125],
            ['amp_sustain', 0.5],
            ['amp_release', 0.02],
            ['master_gain', 0.5],
            ['noise_level', 0],
            ['drift', 0],
            ['chaos_amount', 0],
        ] as const) {
            instance.set_param(name, value);
        }

        const left: number[] = [];
        const right: number[] = [];
        for (let block = 0; block < BLOCKS; block++) {
            switch (block) {
                case 0:
                    instance.note_on(60, 100);
                    break;
                case 16:
                    instance.note_off(60);
                    break;
                case 20:
                    instance.note_on(67, 80);
                    break;
                case 28:
                    instance.note_off(67);
                    break;
            }
            const leftPtr = instance.process(FRAMES_PER_BLOCK);
            const rightPtr = instance.get_right_ptr();
            // A subsequent WASM call may grow memory or overwrite the buffers.
            left.push(...new Float32Array(wasm.memory.buffer, leftPtr, FRAMES_PER_BLOCK));
            right.push(...new Float32Array(wasm.memory.buffer, rightPtr, FRAMES_PER_BLOCK));
        }
        if (instance.get_nan_flush_count() !== 0) {
            throw new Error('WASM Fermenter scrubbed non-finite samples');
        }
        return checkedRender({ framesPerChannel: FRAMES, left, right }, 'WASM');
    } finally {
        instance.free();
    }
}

// Native and WASM may round f32 SIMD/transcendental steps differently. This
// per-sample envelope allows 20 ppm at silence plus 0.02% of signal magnitude;
// it is far below a one-percent gain or a one-sample timing error. No RMS or
// average can hide a single bad sample.
const ABS_TOLERANCE = 2e-5;
const REL_TOLERANCE = 2e-4;

function assertParity(native: StereoRender, wasm: StereoRender): void {
    for (const channel of ['left', 'right'] as const) {
        for (let frame = 0; frame < FRAMES; frame++) {
            const expected = native[channel][frame]!;
            const actual = wasm[channel][frame]!;
            const difference = Math.abs(actual - expected);
            const tolerance = ABS_TOLERANCE + REL_TOLERANCE * Math.max(Math.abs(expected), Math.abs(actual));
            if (difference > tolerance) {
                throw new Error(
                    `${channel}[${frame}]: native=${expected}, WASM=${actual}, difference=${difference}, tolerance=${tolerance}`
                );
            }
        }
    }
}

it(
    'renders the same stereo Fermenter patch and MIDI on native and shipped WASM',
    () => {
        const native = nativeRender();
        const wasm = wasmRender();
        for (const [target, render] of [
            ['native', native],
            ['WASM', wasm],
        ] as const) {
            expect(
                render.left.some((sample) => Math.abs(sample) > 0.01),
                `${target} left is silent`
            ).toBe(true);
            expect(
                render.right.some((sample) => Math.abs(sample) > 0.01),
                `${target} right is silent`
            ).toBe(true);
            expect(
                render.left.some((sample, frame) => Math.abs(sample - render.right[frame]!) > 0.001),
                `${target} lacks stereo separation`
            ).toBe(true);
            expect(
                render.left
                    .slice(16 * FRAMES_PER_BLOCK, 20 * FRAMES_PER_BLOCK)
                    .some((sample) => Math.abs(sample) > 0.001),
                `${target} does not render release`
            ).toBe(true);
        }
        assertParity(native, wasm);

        const perturbedWasm = { ...wasm, left: [...wasm.left] };
        perturbedWasm.left[FRAMES_PER_BLOCK] = perturbedWasm.left[FRAMES_PER_BLOCK]! + 0.01;
        expect(() => assertParity(native, perturbedWasm)).toThrow(/left\[128\]/);
    },
    25 * 60_000
);
