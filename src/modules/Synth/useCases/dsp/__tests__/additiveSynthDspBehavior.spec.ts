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
 * and 0.49*SR) and clamps oscillator frequencies to 0.49*SR, completely suppressing foldback
 * while preserving valid harmonics and declared rolloff.
 */

const DSP_FILE = 'src/modules/Synth/useCases/dsp/additive-synth.dsp';
const COMPILE_TIMEOUT_MS = 120_000;
const FAUST_ASSETS_DIR = './public/faust';

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
    blockSize = 128
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

    it('48000 Hz: suppresses 16 Hz foldback of 16th harmonic (48016 Hz) below -60 dB', async () => {
        const sampleRate = 48_000;
        const output = await renderAdditive(generator, sampleRate, {
            freq: 3001,
            rolloff: 0.5,
            gate: 1,
            gain: 1,
        });

        const startSample = Math.floor(0.5 * sampleRate);
        const endSample = Math.floor(1.0 * sampleRate);

        const fundMag = computeSinusoidalAmplitude(output, sampleRate, 3001, startSample, endSample);
        const foldMag = computeSinusoidalAmplitude(output, sampleRate, 16, startSample, endSample);

        expect(fundMag).toBeGreaterThan(0.03);
        const foldRatioDb = 20 * Math.log10(foldMag / fundMag);
        expect(foldRatioDb).toBeLessThan(-60);
    });

    it('44100 Hz: suppresses 3916 Hz foldback of 16th harmonic (48016 Hz) below -60 dB', async () => {
        const sampleRate = 44_100;
        const output = await renderAdditive(generator, sampleRate, {
            freq: 3001,
            rolloff: 0.5,
            gate: 1,
            gain: 1,
        });

        const startSample = Math.floor(0.5 * sampleRate);
        const endSample = Math.floor(1.0 * sampleRate);

        const fundMag = computeSinusoidalAmplitude(output, sampleRate, 3001, startSample, endSample);
        const foldMag = computeSinusoidalAmplitude(output, sampleRate, 3916, startSample, endSample);

        expect(fundMag).toBeGreaterThan(0.03);
        const foldRatioDb = 20 * Math.log10(foldMag / fundMag);
        expect(foldRatioDb).toBeLessThan(-60);
    });

    it('96000 Hz: suppresses 47984 Hz foldback of 16th harmonic (48016 Hz) below -60 dB', async () => {
        const sampleRate = 96_000;
        const output = await renderAdditive(generator, sampleRate, {
            freq: 3001,
            rolloff: 0.5,
            gate: 1,
            gain: 1,
        });

        const startSample = Math.floor(0.5 * sampleRate);
        const endSample = Math.floor(1.0 * sampleRate);

        const fundMag = computeSinusoidalAmplitude(output, sampleRate, 3001, startSample, endSample);
        const foldMag = computeSinusoidalAmplitude(output, sampleRate, 47984, startSample, endSample);

        expect(fundMag).toBeGreaterThan(0.03);
        const foldRatioDb = 20 * Math.log10(foldMag / fundMag);
        expect(foldRatioDb).toBeLessThan(-60);
    });

    it('Low pitch control (440 Hz): preserves declared rolloff across harmonics below Nyquist', async () => {
        const sampleRate = 48_000;
        const output = await renderAdditive(generator, sampleRate, {
            freq: 440,
            rolloff: 1.5,
            gate: 1,
            gain: 1,
        });

        const startSample = Math.floor(0.5 * sampleRate);
        const endSample = Math.floor(1.0 * sampleRate);

        const h1 = computeSinusoidalAmplitude(output, sampleRate, 440, startSample, endSample);
        const h2 = computeSinusoidalAmplitude(output, sampleRate, 880, startSample, endSample);
        const h3 = computeSinusoidalAmplitude(output, sampleRate, 1320, startSample, endSample);
        const h4 = computeSinusoidalAmplitude(output, sampleRate, 1760, startSample, endSample);

        expect(h1).toBeGreaterThan(0.03);
        expect(h2 / h1).toBeCloseTo(2 ** -1.5, 2);
        expect(h3 / h1).toBeCloseTo(3 ** -1.5, 2);
        expect(h4 / h1).toBeCloseTo(4 ** -1.5, 2);
    });

    it('Finite output at upper keyboard ceiling (12000 Hz): all samples are finite (no NaNs/Infs)', async () => {
        const sampleRate = 48_000;
        const output = await renderAdditive(generator, sampleRate, {
            freq: 12_000,
            rolloff: 1.5,
            gate: 1,
            gain: 1,
        });

        expect(output.length).toBeGreaterThan(0);
        for (let i = 0; i < output.length; i++) {
            expect(Number.isFinite(output[i])).toBe(true);
        }
    });
});
