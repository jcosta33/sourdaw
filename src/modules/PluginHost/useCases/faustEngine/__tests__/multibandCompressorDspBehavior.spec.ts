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
 * Behavior proof for multiband-compressor.dsp (#2300). The file shipped as
 * `process = dm.compressor_demo;` — one fixed band, no `hslider` — while the
 * device UI exposed three thresholds and two crossovers. Reaching a parameter
 * is not enough: each control has to change what comes out, and the bank has
 * to sum flat when no band is compressing, or the device colours the sound at
 * rest and that is worse than the dead knob.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/multiband-compressor.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const TOTAL_S = 1;
/** Steady state: past the crossover filters' and the compressors' transients. */
const MEASURE_FROM_S = 0.6;

const PREFIX = '/Multiband_Compressor';

type Settings = Record<string, number>;

function sine(frequency: number, amplitude: number): (n: number) => number {
    return (n) => amplitude * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
}

async function render(
    generator: FaustMonoDspGeneratorType,
    input: (n: number) => number,
    settings: Settings
): Promise<Float32Array> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        processor.setParamValue(`${PREFIX}/${name}`, value);
    }

    const inputs = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));

    const total = TOTAL_S * SAMPLE_RATE;
    const output = new Float32Array(total);
    for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (const channel of inputs) {
            for (let i = 0; i < BLOCK_SIZE; i++) {
                channel[i] = input(start + i);
            }
        }
        processor.compute(inputs, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            output[start + i] = block[0]?.[i] ?? 0;
        }
    }
    return output;
}

function rmsOf(sample: (n: number) => number, total: number): number {
    let energy = 0;
    const from = Math.floor(MEASURE_FROM_S * SAMPLE_RATE);
    for (let n = from; n < total; n++) {
        energy += sample(n) * sample(n);
    }
    return Math.sqrt(energy / (total - from));
}

function outputRms(output: Float32Array): number {
    return rmsOf((n) => output[n] ?? 0, output.length);
}

function inputRms(input: (n: number) => number): number {
    return rmsOf(input, TOTAL_S * SAMPLE_RATE);
}

/** No band compressing: every threshold above anything the input reaches. */
const OPEN: Settings = { low_threshold: 0, mid_threshold: 0, high_threshold: 0 };

describe('multiband-compressor.dsp behavior (offline render)', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'Multiband_Compressor', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('multiband-compressor.dsp must compile');
        }
        generator = created;
    }, COMPILE_TIMEOUT_MS);

    it('sums the three bands back to unity when no band is compressing', async () => {
        // The crossover frequencies themselves are the hard case: a naive
        // LP/HP/HP split dips or bumps by ~3 dB right there.
        for (const frequency of [80, 200, 800, 3000, 8000]) {
            const input = sine(frequency, 0.25);
            const output = await render(generator, input, { ...OPEN, crossover_low: 200, crossover_high: 3000 });
            const gain = outputRms(output) / inputRms(input);
            expect(gain, `${frequency} Hz`).toBeGreaterThan(0.97);
            expect(gain, `${frequency} Hz`).toBeLessThan(1.03);
        }
    });

    it('sums flat with the two crossovers pushed together', async () => {
        // Both crossovers are user controls, and their declared ranges meet at
        // 500/1000 Hz. That is where the low band's missing upper-crossover
        // phase shift shows: without the compensating allpass the low band is
        // still loud where the mid/high pair has already been phase-rotated,
        // and the sum dips by several dB across the whole overlap.
        for (const frequency of [300, 500, 700, 1000, 1500]) {
            const input = sine(frequency, 0.25);
            const output = await render(generator, input, { ...OPEN, crossover_low: 500, crossover_high: 1000 });
            const gain = outputRms(output) / inputRms(input);
            expect(gain, `${frequency} Hz`).toBeGreaterThan(0.97);
            expect(gain, `${frequency} Hz`).toBeLessThan(1.03);
        }
    });

    it('compresses through the threshold of the band the signal falls in', async () => {
        // 400 Hz sits in the mid band at the default crossovers.
        const input = sine(400, 0.5);
        const open = await render(generator, input, { ...OPEN, crossover_low: 200, crossover_high: 3000 });
        const squashed = await render(generator, input, {
            ...OPEN,
            mid_threshold: -50,
            crossover_low: 200,
            crossover_high: 3000,
        });

        expect(outputRms(squashed)).toBeLessThan(outputRms(open) * 0.2);
    });

    it('moves a band boundary when the low crossover moves', async () => {
        // Same signal, same thresholds: only which band claims 400 Hz changes.
        const input = sine(400, 0.5);
        const settings: Settings = { low_threshold: 0, mid_threshold: -50, high_threshold: 0, crossover_high: 3000 };
        const inMidBand = await render(generator, input, { ...settings, crossover_low: 50 });
        const inLowBand = await render(generator, input, { ...settings, crossover_low: 500 });

        expect(outputRms(inLowBand)).toBeGreaterThan(outputRms(inMidBand) * 3);
    });

    it('moves a band boundary when the high crossover moves', async () => {
        const input = sine(5000, 0.5);
        const settings: Settings = { low_threshold: 0, mid_threshold: 0, high_threshold: -50, crossover_low: 200 };
        const inMidBand = await render(generator, input, { ...settings, crossover_high: 10_000 });
        const inHighBand = await render(generator, input, { ...settings, crossover_high: 1000 });

        expect(outputRms(inMidBand)).toBeGreaterThan(outputRms(inHighBand) * 3);
    });

    it('compresses each band through its own threshold', async () => {
        // A threshold only reaches the band it names: dropping the low
        // threshold must not touch a signal sitting in the high band.
        const input = sine(6000, 0.5);
        const base: Settings = { ...OPEN, crossover_low: 200, crossover_high: 3000 };
        const open = await render(generator, input, base);
        const lowSquashed = await render(generator, input, { ...base, low_threshold: -50 });
        const highSquashed = await render(generator, input, { ...base, high_threshold: -50 });

        expect(outputRms(lowSquashed)).toBeCloseTo(outputRms(open), 3);
        expect(outputRms(highSquashed)).toBeLessThan(outputRms(open) * 0.2);
    });
});
