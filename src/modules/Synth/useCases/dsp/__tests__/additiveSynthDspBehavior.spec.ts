// @vitest-environment node
import { copyFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    FaustCompiler,
    FaustMonoDspGenerator,
    instantiateFaustModuleFromFile,
    LibFaust,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Behavior proof for additive-synth.dsp (#3782):
 * The Additive Synth sums 16 harmonics. At high pitches or low sample rates,
 * upper harmonics exceed the Nyquist frequency and fold back as loud, discordant
 * aliased tones not in the intended harmonic series.
 *
 * For example, at a 3001 Hz fundamental with rolloff 0.5 at 48 kHz, the 16th harmonic
 * is 48016 Hz, which folds to 16 Hz at approximately -12.04 dB relative to the fundamental.
 *
 * The fix weights harmonics with a smooth C1 transition before Nyquist (between 0.45*SR
 * and 0.49*SR), suppressing foldback while preserving valid harmonics and declared rolloff.
 */

const DSP_FILE = 'src/modules/Synth/useCases/dsp/additive-synth.dsp';
const COMPILE_TIMEOUT_MS = 120_000;
const FAUST_ASSETS_DIR = './public/faust';
const PARTIAL_COUNT = 16;
const STEADY_ENVELOPE_LEVEL = 0.7;
const NORMALIZED_FUNDAMENTAL_AMPLITUDE = STEADY_ENVELOPE_LEVEL / PARTIAL_COUNT;
const ALIAS_FLOOR_DB = -60;
const SAMPLE_RATES = [44_100, 48_000, 96_000] as const;
const UPPER_FUNDAMENTALS = [3001, 5003, 8009, 11_999, 12_000] as const;

let copyCounter = 0;

/**
 * Instantiate the libfaust compiler for a spec, race-free.
 * Local to this spec to satisfy cross-module-index-only boundary rules.
 */
async function loadFaustCompilerForSpec(): Promise<IFaustCompiler> {
    copyCounter += 1;
    const jsCopy = join(tmpdir(), `libfaust-wasm-spec-${process.pid}-${copyCounter}.js`);
    copyFileSync(join(FAUST_ASSETS_DIR, 'libfaust-wasm.js'), jsCopy);
    try {
        const faustModule = await instantiateFaustModuleFromFile(
            jsCopy,
            join(FAUST_ASSETS_DIR, 'libfaust-wasm.data'),
            join(FAUST_ASSETS_DIR, 'libfaust-wasm.wasm')
        );
        return new FaustCompiler(new LibFaust(faustModule));
    } finally {
        unlinkSync(jsCopy);
    }
}

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

async function renderAdditive(
    generator: FaustMonoDspGeneratorType,
    sampleRate: number,
    settings: Settings,
    durationS = 1.0,
    blockSize = 128,
    settingsAtBlock?: (startSample: number) => Settings | undefined
): Promise<Float32Array> {
    const processor = await generator.createOfflineProcessor(sampleRate, blockSize);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        const address = paramAddressMap.get(name) ?? name;
        processor.setParamValue(address, value);
    }

    const numInputs = processor.getNumInputs();
    const numOutputs = processor.getNumOutputs();
    const inputs = Array.from({ length: numInputs }, () => new Float32Array(blockSize));
    const block = Array.from({ length: numOutputs }, () => new Float32Array(blockSize));

    const total = Math.floor(durationS * sampleRate);
    const output = new Float32Array(total);
    for (let start = 0; start < total; start += blockSize) {
        const updatedSettings = settingsAtBlock?.(start);
        for (const [name, value] of Object.entries(updatedSettings ?? {})) {
            const address = paramAddressMap.get(name) ?? name;
            processor.setParamValue(address, value);
        }
        processor.compute(inputs, block);
        for (let i = 0; i < blockSize; i++) {
            if (start + i < total) {
                output[start + i] = block[0]?.[i] ?? 0;
            }
        }
    }
    return output;
}

function computeSinusoidalAmplitude(
    samples: Float32Array,
    sampleRate: number,
    targetFreq: number,
    startSample: number,
    endSample: number
): number {
    const nSamples = endSample - startSample;
    if (nSamples <= 0) {
        return 0;
    }
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * targetFreq) / sampleRate;
    for (let n = startSample; n < endSample; n++) {
        const x = samples[n] ?? 0;
        re += x * Math.cos(omega * n);
        im += x * Math.sin(omega * n);
    }
    re = (2 / nSamples) * re;
    im = (2 / nSamples) * im;
    return Math.hypot(re, im);
}

function assertFiniteOutput(samples: Float32Array): void {
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((sample) => Number.isFinite(sample))).toBe(true);
}

function steadyWindow(samples: Float32Array, sampleRate: number): [number, number] {
    return [samples.length - sampleRate, samples.length];
}

function ratioDb(amplitude: number, reference: number): number {
    return 20 * Math.log10(amplitude / reference);
}

function foldToNyquist(frequency: number, sampleRate: number): number {
    const wrapped = frequency % sampleRate;
    return Math.min(wrapped, sampleRate - wrapped);
}

function measurableAliasFrequencies(fundamental: number, sampleRate: number): number[] {
    const nyquist = sampleRate / 2;
    const retainedHarmonics = Array.from({ length: PARTIAL_COUNT }, (_, index) => fundamental * (index + 1)).filter(
        (frequency) => frequency < sampleRate * 0.49
    );
    const aliases = Array.from({ length: PARTIAL_COUNT }, (_, index) => fundamental * (index + 1))
        .filter((frequency) => frequency > nyquist)
        .map((frequency) => foldToNyquist(frequency, sampleRate))
        .filter((frequency) => frequency > 0 && frequency < nyquist)
        .filter(
            (frequency) =>
                !retainedHarmonics.some((retainedFrequency) => Math.abs(retainedFrequency - frequency) < 1e-6)
        );

    return [...new Set(aliases)];
}

function maximumAbsoluteSample(samples: Float32Array, startSample = 0): number {
    let peak = 0;
    for (let index = startSample; index < samples.length; index++) {
        peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    return peak;
}

describe('additive-synth.dsp anti-aliasing behavior', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'additive_synth', dspCode, '');
        if (!compiled) {
            throw new Error('additive-synth.dsp must compile');
        }
        generator = created;

        const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
        extractAddresses(json.ui ?? []);
    }, COMPILE_TIMEOUT_MS);

    it.each(SAMPLE_RATES)(
        '%i Hz: retains all 16 low-note partials with declared rolloff and normalization',
        async (sampleRate) => {
            const rolloff = 1.5;
            const output = await renderAdditive(generator, sampleRate, { freq: 440, rolloff, gate: 1, gain: 1 }, 2);

            assertFiniteOutput(output);
            const [startSample, endSample] = steadyWindow(output, sampleRate);
            const fundamental = computeSinusoidalAmplitude(output, sampleRate, 440, startSample, endSample);

            for (let partial = 1; partial <= PARTIAL_COUNT; partial++) {
                const amplitude = computeSinusoidalAmplitude(output, sampleRate, 440 * partial, startSample, endSample);
                const measuredRatio = amplitude / fundamental;
                expect(measuredRatio).toBeCloseTo(partial ** -rolloff, 3);
            }
            expect(fundamental).toBeCloseTo(NORMALIZED_FUNDAMENTAL_AMPLITUDE, 3);
        }
    );

    it.each(
        SAMPLE_RATES.flatMap((sampleRate) =>
            UPPER_FUNDAMENTALS.map((fundamental) => [sampleRate, fundamental] as const)
        )
    )(
        '%i Hz at %i Hz: retains valid harmonics and keeps measurable aliases below -60 dB',
        async (sampleRate, fundamentalFrequency) => {
            const rolloff = 0.5;
            const output = await renderAdditive(
                generator,
                sampleRate,
                { freq: fundamentalFrequency, rolloff, gate: 1, gain: 1 },
                2
            );

            assertFiniteOutput(output);
            const [startSample, endSample] = steadyWindow(output, sampleRate);
            const fundamental = computeSinusoidalAmplitude(
                output,
                sampleRate,
                fundamentalFrequency,
                startSample,
                endSample
            );

            expect(fundamental).toBeCloseTo(NORMALIZED_FUNDAMENTAL_AMPLITUDE, 3);
            for (let partial = 1; partial <= PARTIAL_COUNT; partial++) {
                const harmonicFrequency = fundamentalFrequency * partial;
                if (harmonicFrequency > sampleRate * 0.45) {
                    break;
                }
                const amplitude = computeSinusoidalAmplitude(
                    output,
                    sampleRate,
                    harmonicFrequency,
                    startSample,
                    endSample
                );
                expect(amplitude / fundamental).toBeCloseTo(partial ** -rolloff, 3);
            }

            const aliasFrequencies = measurableAliasFrequencies(fundamentalFrequency, sampleRate);
            const collisionOnlyGrid = fundamentalFrequency === 12_000 && sampleRate !== 44_100;
            if (collisionOnlyGrid) {
                // At 48/96 kHz, every 12 kHz-grid alias lands on DC, Nyquist, or a retained harmonic.
                // The adjacent 11,999 Hz case keeps the alias-floor oracle active at both rates.
                expect(aliasFrequencies).toEqual([]);
            } else {
                expect(aliasFrequencies.length).toBeGreaterThan(0);
            }
            for (const aliasFrequency of aliasFrequencies) {
                const aliasAmplitude = computeSinusoidalAmplitude(
                    output,
                    sampleRate,
                    aliasFrequency,
                    startSample,
                    endSample
                );
                const aliasLevelDb = ratioDb(aliasAmplitude, fundamental);
                expect(aliasLevelDb).toBeLessThan(ALIAS_FLOOR_DB);
            }
        }
    );

    it.each([
        [44_100, 3],
        [48_000, 2],
        [96_000, 4],
    ] as const)(
        '%i Hz: renders full, intermediate, and suppressed partial levels across the Nyquist taper',
        async (sampleRate, partial) => {
            const fundamentals = [
                Math.floor((sampleRate * 0.45) / partial),
                (sampleRate * 0.47) / partial,
                Math.ceil((sampleRate * 0.49) / partial) + 1,
            ];
            const normalizedRatios: number[] = [];

            for (const fundamentalFrequency of fundamentals) {
                const output = await renderAdditive(
                    generator,
                    sampleRate,
                    { freq: fundamentalFrequency, rolloff: 0.5, gate: 1, gain: 1 },
                    2
                );
                assertFiniteOutput(output);
                const [startSample, endSample] = steadyWindow(output, sampleRate);
                const fundamental = computeSinusoidalAmplitude(
                    output,
                    sampleRate,
                    fundamentalFrequency,
                    startSample,
                    endSample
                );
                const taperedPartial = computeSinusoidalAmplitude(
                    output,
                    sampleRate,
                    fundamentalFrequency * partial,
                    startSample,
                    endSample
                );
                expect(fundamental).toBeCloseTo(NORMALIZED_FUNDAMENTAL_AMPLITUDE, 3);
                normalizedRatios.push(taperedPartial / fundamental / partial ** -0.5);
            }

            expect(normalizedRatios[0]).toBeGreaterThan(0.99);
            expect(normalizedRatios[0]).toBeLessThan(1.01);
            expect(normalizedRatios[1]).toBeGreaterThan(0.4);
            expect(normalizedRatios[1]).toBeLessThan(0.6);
            expect(ratioDb(normalizedRatios[2] ?? 0, 1)).toBeLessThan(ALIAS_FLOOR_DB);
        }
    );

    // Held points make the taper envelope phase-independent after live parameter updates.
    // They do not claim that a continuously ramped pitch has a smooth transient.
    it('follows held taper levels after live frequency updates within the two-partial peak bound', async () => {
        const sampleRate = 48_000;
        const segmentSamples = sampleRate;
        const points = [
            { startSample: 0, frequency: 10_800 },
            { startSample: 2 * segmentSamples, frequency: 11_040 },
            { startSample: 3 * segmentSamples, frequency: 11_280 },
            { startSample: 4 * segmentSamples, frequency: 11_520 },
            { startSample: 5 * segmentSamples, frequency: 11_761 },
        ];
        const settingsByStartSample = new Map(
            points.map(({ startSample, frequency }) => [startSample, { freq: frequency }])
        );
        const output = await renderAdditive(
            generator,
            sampleRate,
            { freq: points[0]?.frequency ?? 10_800, rolloff: 0.5, gate: 1, gain: 1 },
            6,
            128,
            (startSample) => settingsByStartSample.get(startSample)
        );

        assertFiniteOutput(output);
        const normalizedWeights: number[] = [];
        for (const [index, point] of points.entries()) {
            const startSample = index === 0 ? segmentSamples : point.startSample;
            const endSample = startSample + segmentSamples;
            const fundamental = computeSinusoidalAmplitude(output, sampleRate, point.frequency, startSample, endSample);
            const secondPartial = computeSinusoidalAmplitude(
                output,
                sampleRate,
                point.frequency * 2,
                startSample,
                endSample
            );
            expect(fundamental).toBeCloseTo(NORMALIZED_FUNDAMENTAL_AMPLITUDE, 3);
            normalizedWeights.push(secondPartial / fundamental / 2 ** -0.5);
        }

        expect(normalizedWeights[0]).toBeGreaterThan(0.99);
        expect(normalizedWeights[0]).toBeLessThan(1.01);
        expect(normalizedWeights[1]).toBeGreaterThan(0.8);
        expect(normalizedWeights[1]).toBeLessThan(0.88);
        expect(normalizedWeights[2]).toBeGreaterThan(0.45);
        expect(normalizedWeights[2]).toBeLessThan(0.55);
        expect(normalizedWeights[3]).toBeGreaterThan(0.12);
        expect(normalizedWeights[3]).toBeLessThan(0.2);
        expect(ratioDb(normalizedWeights[4] ?? 0, 1)).toBeLessThan(ALIAS_FLOOR_DB);

        for (let index = 1; index < normalizedWeights.length; index++) {
            expect(normalizedWeights[index]).toBeLessThan(normalizedWeights[index - 1] ?? Infinity);
        }

        const settledTwoPartialPeakBound = NORMALIZED_FUNDAMENTAL_AMPLITUDE * (1 + 2 ** -0.5) + 1e-4;
        const measuredPeak = maximumAbsoluteSample(output, segmentSamples);
        expect(measuredPeak).toBeLessThanOrEqual(settledTwoPartialPeakBound);
    });
});
