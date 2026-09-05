// @vitest-environment node
import { readFileSync } from 'node:fs';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import {
    FaustMonoDspGenerator,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
} from '@grame/faustwasm/dist/esm/index.js';
import { describe, expect, it, beforeAll } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';

/**
 * Behavior proof for the shipped noise-gate.dsp (review #563): compiled
 * through the app's own Faust path and rendered offline, the gate must SUSTAIN
 * open while the input stays above threshold (the previous en.ar one-shot
 * envelope closed itself by ~111 ms under a loud signal) and must close only
 * after hold + release once the input drops below threshold.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/noise-gate.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
/** 0.5 (loud, above -60 dB threshold) until DROP_S, then 0.0005 (-66 dB, below). */
const DROP_S = 1.2;
const LOUD = 0.5;
const QUIET = 0.0005;
const TOTAL_S = 2.4;

function inputAt(n: number): number {
    const t = n / SAMPLE_RATE;
    const amp = t < DROP_S ? LOUD : QUIET;
    return amp * Math.sin(2 * Math.PI * 440 * t);
}

async function renderGate(generator: FaustMonoDspGeneratorType, holdSeconds: number): Promise<Float32Array> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    processor.setParamValue('/noise-gate/hold', holdSeconds);

    const input = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));

    const total = TOTAL_S * SAMPLE_RATE;
    const output = new Float32Array(total);
    for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (const channel of input) {
            for (let i = 0; i < BLOCK_SIZE; i++) {
                channel[i] = inputAt(start + i);
            }
        }
        processor.compute(input, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            output[start + i] = block[0]![i]!;
        }
    }
    return output;
}

function rms(signal: (n: number) => number, t0: number, t1: number): number {
    let energy = 0;
    for (let n = Math.floor(t0 * SAMPLE_RATE); n < Math.floor(t1 * SAMPLE_RATE); n++) {
        energy += signal(n) * signal(n);
    }
    return Math.sqrt(energy / ((t1 - t0) * SAMPLE_RATE));
}

function ratio(output: Float32Array, t0: number, t1: number): number {
    return rms((n) => output[n] ?? 0, t0, t1) / rms(inputAt, t0, t1);
}

describe('noise-gate.dsp behavior (offline render)', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'noise-gate', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('noise-gate.dsp must compile');
        }
        generator = created;
    }, COMPILE_TIMEOUT_MS);

    it('sustains open while the input stays above threshold', async () => {
        const output = await renderGate(generator, 0.01);

        // The en.ar one-shot defect closed the gate by ~111 ms under a loud
        // signal; both windows must stay at unity gain.
        expect(ratio(output, 0.05, 0.111)).toBeGreaterThan(0.95);
        expect(ratio(output, 0.9, 1.0)).toBeGreaterThan(0.95);
    });

    it('holds open for the hold time after the input drops below threshold', async () => {
        const output = await renderGate(generator, 0.1);

        // Input dropped below threshold at 1.2 s; with a 0.1 s hold the gate
        // must still be fully open in this window (the peak follower's own
        // decay alone would have started the release).
        expect(ratio(output, 1.25, 1.3)).toBeGreaterThan(0.9);
    });

    it('closes after hold + release once the input stays below threshold', async () => {
        const output = await renderGate(generator, 0.1);

        expect(ratio(output, 1.9, 2.0)).toBeLessThan(0.05);
    });

    it('sustains open when hold is 0 while input stays above threshold, then closes after release', async () => {
        const output = await renderGate(generator, 0);

        expect(ratio(output, 0.05, 0.111)).toBeGreaterThan(0.95);
        expect(ratio(output, 0.9, 1.0)).toBeGreaterThan(0.95);
        expect(ratio(output, 1.9, 2.0)).toBeLessThan(0.05);
    });

    it('sustains open when hold is sub-sample while input stays above threshold', async () => {
        const output = await renderGate(generator, 0.00001);

        expect(ratio(output, 0.05, 0.111)).toBeGreaterThan(0.95);
        expect(ratio(output, 0.9, 1.0)).toBeGreaterThan(0.95);
        expect(ratio(output, 1.9, 2.0)).toBeLessThan(0.05);
    });
});
