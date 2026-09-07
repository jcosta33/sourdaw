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
 * Behavior proof for pro-parametric-eq.dsp (#3729):
 * Faust's fi.peak_eq(Lfx, fx, B) expects bandwidth B in Hertz.
 * Passing the dimensionless Q slider mf_q directly to fi.peak_eq inverted Q
 * semantics: Q=1 produced a 1 Hz bandwidth resonance instead of a broad bell,
 * and higher Q widened the filter rather than narrowing it.
 *
 * The fix switches to fi.peak_eq_cq(Lfx, fx, Q), which implements constant-Q
 * peaking equalization where B = fx / Q.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/pro-parametric-eq.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const TOTAL_S = 0.5;
/** Measure steady state past initial filter settling. */
const MEASURE_FROM_S = 0.1;

type Settings = Record<string, number>;

type UiItem = {
    items?: UiItem[];
    address?: string;
};

const paramAddressMap = new Map<string, string>();

function extractAddresses(items: UiItem[]): void {
    for (const item of items) {
        if (item.items) {
            extractAddresses(item.items);
        } else if (item.address) {
            const bare = item.address.split('/').pop();
            if (bare) {
                paramAddressMap.set(bare, item.address);
            }
        }
    }
}

async function renderEq(
    generator: FaustMonoDspGeneratorType,
    inputSignalFn: (n: number) => number,
    settings: Settings
): Promise<Float32Array> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        const address = paramAddressMap.get(name);
        if (address) {
            processor.setParamValue(address, value);
        }
    }

    const inputs = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));

    const total = Math.floor(TOTAL_S * SAMPLE_RATE);
    const output = new Float32Array(total);
    for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (const channel of inputs) {
            for (let i = 0; i < BLOCK_SIZE; i++) {
                channel[i] = inputSignalFn(start + i);
            }
        }
        processor.compute(inputs, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            if (start + i < total) {
                output[start + i] = block[0]?.[i] ?? 0;
            }
        }
    }
    return output;
}

function rms(signal: Float32Array | ((n: number) => number), fromSample: number, toSample: number): number {
    let energy = 0;
    for (let i = fromSample; i < toSample; i++) {
        const sample = typeof signal === 'function' ? signal(i) : (signal[i] ?? 0);
        energy += sample * sample;
    }
    return Math.sqrt(energy / (toSample - fromSample));
}

function sine(frequency: number, amplitude: number): (n: number) => number {
    return (n) => amplitude * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
}

describe('pro-parametric-eq.dsp behavior (offline render)', () => {
    let generator: FaustMonoDspGeneratorType;
    const fromSample = Math.floor(MEASURE_FROM_S * SAMPLE_RATE);
    const toSample = Math.floor(TOTAL_S * SAMPLE_RATE);

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'pro-parametric-eq', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('pro-parametric-eq.dsp must compile');
        }
        generator = created;

        const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
        extractAddresses(json.ui ?? []);
    }, COMPILE_TIMEOUT_MS);

    it('exact identity / flat response when all gains are 0 dB', async () => {
        const input = sine(1000, 0.5);
        const output = await renderEq(generator, input, {
            lf_gain: 0,
            mf_gain: 0,
            hf_gain: 0,
        });

        // Magnitude response is perfectly flat at unity gain
        const outRms = rms(output, fromSample, toSample);
        const inRms = rms(input, fromSample, toSample);
        expect(Math.abs(outRms - inRms)).toBeLessThan(1e-5);

        // Faust's fi.low_shelf and fi.high_shelf are odd-order Butterworth filterbanks
        // which are allpass-complementary (perfectly flat magnitude with sub-sample allpass phase delay).
        // Once aligned with the filterbank phase offset at 1 kHz, the waveform matches input within 1e-4.
        const zeroCrossing = 5424; // 113 full cycles at 1000 Hz / 48 kHz
        const sinVal = (output[zeroCrossing] ?? 0) / 0.5;
        const cosVal = (output[zeroCrossing + 12] ?? 0) / 0.5; // 90-degree offset (12 samples)
        const phase = Math.atan2(sinVal, cosVal);

        let maxDiff = 0;
        for (let i = fromSample; i < toSample; i++) {
            const expected = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE + phase);
            const diff = Math.abs((output[i] ?? 0) - expected);
            if (diff > maxDiff) {
                maxDiff = diff;
            }
        }
        expect(maxDiff).toBeLessThan(1e-4);
    });

    it('Mid Q semantics: higher Q narrows the bell and Q=1 provides wide boost at 1500 Hz', async () => {
        const input = sine(1500, 0.5);
        const dryRms = rms(input, fromSample, toSample);

        const outQ1 = await renderEq(generator, input, {
            mf_freq: 1000,
            mf_gain: 18,
            mf_q: 1,
        });
        const outQ10 = await renderEq(generator, input, {
            mf_freq: 1000,
            mf_gain: 18,
            mf_q: 10,
        });

        const rmsQ1 = rms(outQ1, fromSample, toSample);
        const rmsQ10 = rms(outQ10, fromSample, toSample);

        expect(rmsQ1).toBeGreaterThan(rmsQ10 * 1.5);
        expect(rmsQ1 / dryRms).toBeGreaterThan(1.3);
        expect(rmsQ10).toBeLessThan(0.4);
    });

    it('Center frequency boost: 1000 Hz input receives full ~18 dB boost across Q settings', async () => {
        const input = sine(1000, 0.1);
        const inRms = rms(input, fromSample, toSample);

        const outQ1 = await renderEq(generator, input, {
            mf_freq: 1000,
            mf_gain: 18,
            mf_q: 1,
        });
        const outQ10 = await renderEq(generator, input, {
            mf_freq: 1000,
            mf_gain: 18,
            mf_q: 10,
        });

        const rmsQ1 = rms(outQ1, fromSample, toSample);
        const rmsQ10 = rms(outQ10, fromSample, toSample);

        const ratioQ1 = rmsQ1 / inRms;
        const ratioQ10 = rmsQ10 / inRms;

        expect(ratioQ1).toBeGreaterThan(7.0);
        expect(ratioQ1).toBeLessThan(9.0);
        expect(ratioQ10).toBeGreaterThan(7.0);
        expect(ratioQ10).toBeLessThan(9.0);
    });

    it('Mid Q scales bandwidth monotonically across Q values', async () => {
        const input = sine(1500, 0.5);

        const qValues = [0.5, 1.0, 5.0, 10.0] as const;
        const rmsValues: number[] = [];

        for (const q of qValues) {
            const out = await renderEq(generator, input, {
                mf_freq: 1000,
                mf_gain: 18,
                mf_q: q,
            });
            rmsValues.push(rms(out, fromSample, toSample));
        }

        const [rms05, rms1, rms5, rms10] = rmsValues;
        expect(rms05).toBeDefined();
        expect(rms1).toBeDefined();
        expect(rms5).toBeDefined();
        expect(rms10).toBeDefined();
        expect(rms05!).toBeGreaterThan(rms1!);
        expect(rms1!).toBeGreaterThan(rms5!);
        expect(rms5!).toBeGreaterThan(rms10!);
    });
});
