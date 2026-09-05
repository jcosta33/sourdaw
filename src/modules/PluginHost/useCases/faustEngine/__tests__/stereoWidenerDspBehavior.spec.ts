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
 * Behavior proof for stereo-widener.dsp (#3728):
 * The previous dynamic ducker computed an envelope from a lowpass filter and
 * multiplied the unfiltered side by (1.0 - duck). That ducked full-band side
 * dynamically based on amplitude (failing at quiet levels, inverting/amplifying
 * at hot levels).
 *
 * The fix implements a true crossover highpass filter on the side signal:
 * frequencies below mono_bass are filtered out regardless of amplitude,
 * high frequencies pass intact, and mono_bass = 0 maintains exact identity.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/stereo-widener.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const TOTAL_S = 1.0;
/** Measure steady state past initial filter settling. */
const MEASURE_FROM_S = 0.2;

const PREFIX = '/stereo-widener';

type Settings = Record<string, number>;

async function renderStereo(
    generator: FaustMonoDspGeneratorType,
    channels: readonly [(n: number) => number, (n: number) => number],
    settings: Settings
): Promise<{ left: Float32Array; right: Float32Array }> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        processor.setParamValue(`${PREFIX}/${name}`, value);
    }

    const inputs = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));

    const total = TOTAL_S * SAMPLE_RATE;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (const [channelIndex, channel] of inputs.entries()) {
            const source = channels[channelIndex];
            if (!source) {
                continue;
            }
            for (let i = 0; i < BLOCK_SIZE; i++) {
                channel[i] = source(start + i);
            }
        }
        processor.compute(inputs, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            left[start + i] = block[0]?.[i] ?? 0;
            right[start + i] = block[1]?.[i] ?? 0;
        }
    }
    return { left, right };
}

function rms(signal: Float32Array, fromSample: number, toSample: number): number {
    let energy = 0;
    for (let i = fromSample; i < toSample; i++) {
        const sample = signal[i] ?? 0;
        energy += sample * sample;
    }
    return Math.sqrt(energy / (toSample - fromSample));
}

function sine(frequency: number, amplitude: number): (n: number) => number {
    return (n) => amplitude * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
}

describe('stereo-widener.dsp behavior (offline render)', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'stereo-widener', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('stereo-widener.dsp must compile');
        }
        generator = created;
    }, COMPILE_TIMEOUT_MS);

    it('exact identity when mono_bass is 0 at width 100', async () => {
        const inputL = sine(440, 0.5);
        const inputR = sine(880, 0.5);

        const { left, right } = await renderStereo(generator, [inputL, inputR], {
            width: 100,
            mono_bass: 0,
        });

        const total = TOTAL_S * SAMPLE_RATE;
        let maxDiff = 0;
        for (let i = 0; i < total; i++) {
            const diffL = Math.abs((left[i] ?? 0) - inputL(i));
            const diffR = Math.abs((right[i] ?? 0) - inputR(i));
            if (diffL > maxDiff) {
                maxDiff = diffL;
            }
            if (diffR > maxDiff) {
                maxDiff = diffR;
            }
        }

        expect(maxDiff).toBeLessThan(1e-5);
    });

    it('attenuates bass from side channel independently of input amplitude', async () => {
        const amplitudes = [0.01, 0.5, 4.0] as const;
        const fromSample = Math.floor(MEASURE_FROM_S * SAMPLE_RATE);
        const toSample = TOTAL_S * SAMPLE_RATE;

        const attenuationRatios: number[] = [];

        for (const amplitude of amplitudes) {
            const inputSideSignal = sine(50, amplitude);
            const inputL = (n: number): number => inputSideSignal(n);
            const inputR = (n: number): number => -inputSideSignal(n);

            const { left, right } = await renderStereo(generator, [inputL, inputR], {
                width: 100,
                mono_bass: 500,
            });

            // For pure side input, mid = 0, side = (L - R) * 0.5
            const outputSide = new Float32Array(toSample);
            const inputSide = new Float32Array(toSample);
            for (let i = 0; i < toSample; i++) {
                outputSide[i] = ((left[i] ?? 0) - (right[i] ?? 0)) * 0.5;
                inputSide[i] = (inputL(i) - inputR(i)) * 0.5;
            }

            const outSideRms = rms(outputSide, fromSample, toSample);
            const inSideRms = rms(inputSide, fromSample, toSample);
            const ratio = outSideRms / inSideRms;

            attenuationRatios.push(ratio);
        }

        const [ratioQuiet, ratioNominal, ratioHot] = attenuationRatios;
        expect(ratioQuiet).toBeDefined();
        expect(ratioNominal).toBeDefined();
        expect(ratioHot).toBeDefined();

        // 1. Decisively attenuates 50 Hz side bass (< 0.25, ~0.10 for 1st order)
        expect(ratioQuiet).toBeLessThan(0.25);
        expect(ratioNominal).toBeLessThan(0.25);
        expect(ratioHot).toBeLessThan(0.25);

        // 2. Attenuation ratio is consistent across all amplitudes (< 1% variation across quiet, nominal, and hot)
        const minRatio = Math.min(...attenuationRatios);
        const maxRatio = Math.max(...attenuationRatios);
        expect((maxRatio - minRatio) / minRatio).toBeLessThan(0.01);
    });

    it('preserves high-frequency side content when mono_bass is active', async () => {
        const fromSample = Math.floor(MEASURE_FROM_S * SAMPLE_RATE);
        const toSample = TOTAL_S * SAMPLE_RATE;

        const inputSideSignal = sine(5000, 0.5);
        const inputL = (n: number): number => inputSideSignal(n);
        const inputR = (n: number): number => -inputSideSignal(n);

        const { left, right } = await renderStereo(generator, [inputL, inputR], {
            width: 100,
            mono_bass: 500,
        });

        const outputSide = new Float32Array(toSample);
        const inputSide = new Float32Array(toSample);
        for (let i = 0; i < toSample; i++) {
            outputSide[i] = ((left[i] ?? 0) - (right[i] ?? 0)) * 0.5;
            inputSide[i] = (inputL(i) - inputR(i)) * 0.5;
        }

        const outSideRms = rms(outputSide, fromSample, toSample);
        const inSideRms = rms(inputSide, fromSample, toSample);
        const ratio = outSideRms / inSideRms;

        // High frequencies pass through with full stereo width (> 0.95)
        expect(ratio).toBeGreaterThan(0.95);
    });
});
