// @vitest-environment node
import { readFileSync } from 'node:fs';

import {
    FaustMonoDspGenerator,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
    type FaustPolyDspGenerator as FaustPolyDspGeneratorType,
    type IFaustCompiler,
    type IFaustPolyOfflineProcessor,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';
import { compileEffectFreeFaustPolyDsp } from '../compileEffectFreeFaustPolyDsp';

vi.mock('@grame/faustwasm', async () => import('@grame/faustwasm/dist/esm/index.js'));

/**
 * Behavior proof for supersaw-unison.dsp resonant filter routing (#3722):
 *
 * Defect:
 * Supersaw Unison passed raw oscillator mix as 3rd arg of fi.resonlp:
 *   filtered = fi.resonlp(mod_cutoff, 1 + resonance * 8, raw);
 * In Faust, resonlp signature is resonlp(fc, Q, gain, x).
 * Supplying 3 arguments treats the 3rd argument as filter gain, leaving
 * an unbound external audio inlet. The compiled instrument therefore had
 * 1 audio input instead of 0, and on a standard MIDI instrument track
 * (input = 0) was completely silent when played.
 *
 * Fix:
 * Pipe raw signal into the resonant filter with unity gain:
 *   filtered = raw : fi.resonlp(mod_cutoff, 1 + resonance * 8, 1);
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/supersaw-unison.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

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

async function renderSupersawStereo(
    generator: FaustMonoDspGeneratorType,
    sampleRate: number,
    settings: Settings,
    durationS = 0.5,
    blockSize = 128
): Promise<{ left: Float32Array; right: Float32Array; peak: number }> {
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
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    let peak = 0;

    for (let start = 0; start < total; start += blockSize) {
        processor.compute(inputs, block);
        for (let i = 0; i < blockSize; i++) {
            if (start + i < total) {
                const l = block[0]?.[i] ?? 0;
                const r = block[1]?.[i] ?? 0;
                left[start + i] = l;
                right[start + i] = r;
                const mag = Math.max(Math.abs(l), Math.abs(r));
                if (mag > peak) {
                    peak = mag;
                }
            }
        }
    }
    return { left, right, peak };
}

describe('supersaw-unison.dsp resonant filter routing (#3722)', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'supersaw_unison', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('supersaw-unison.dsp must compile');
        }
        generator = created;

        const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
        extractAddresses(json.ui ?? []);
    }, COMPILE_TIMEOUT_MS);

    it('supersaw-unison instrument has 0 audio inputs', async () => {
        const processor = await generator.createOfflineProcessor(48_000, 128);
        expect(processor.getNumInputs()).toBe(0);
    });

    it('produces audible nonzero output when gated without external audio inputs', async () => {
        const sampleRate = 48_000;
        const { peak } = await renderSupersawStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            cutoff: 6000,
            resonance: 0.3,
        });

        expect(peak).toBeGreaterThan(0.05);
    });

    it('changing cutoff modulates spectral brightness/energy', async () => {
        const sampleRate = 48_000;
        const dark = await renderSupersawStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            cutoff: 400,
            resonance: 0.1,
        });
        const bright = await renderSupersawStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            cutoff: 12000,
            resonance: 0.1,
        });

        expect(bright.peak).toBeGreaterThan(dark.peak);
    });

    it('produces silence when gate is 0', async () => {
        const sampleRate = 48_000;
        const { peak } = await renderSupersawStereo(generator, sampleRate, {
            freq: 440,
            gate: 0,
        });

        expect(peak).toBe(0);
    });
});

/**
 * Note velocity reaches the supersaw's level. The app compiles instruments
 * through `FaustPolyDspGenerator` (`compileEffectFreeFaustPolyDsp`, eight voices
 * as `createFaustNode`), whose voice allocator writes `gain = velocity / 127` on
 * the voice each `keyOn` takes — the same surface every live, sequenced and
 * offline route reaches. A DSP without a `gain` control ignores that write, so
 * every velocity played at one level.
 */
describe('supersaw-unison.dsp velocity level', () => {
    const SAMPLE_RATE = 48_000;
    const BLOCK_SIZE = 512;
    const VOICES = 8;
    const RENDER_BLOCKS = 24;
    /** The output stage before the DSP declared `gain`: no level control at all. */
    const PRE_GAIN_OUTPUT = 'process = filtered * en.adsr(';
    const GAIN_OUTPUT = 'process = filtered * gain * en.adsr(';
    let poly: FaustPolyDspGeneratorType;
    let preGainPoly: FaustPolyDspGeneratorType;

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();
        const source = readFileSync(DSP_FILE, 'utf8');
        const compiled = await compileEffectFreeFaustPolyDsp(compiler, 'Supersaw_Unison', source, '-I libraries/');
        if (!compiled) {
            throw new Error('supersaw-unison.dsp must compile as a poly instrument');
        }
        poly = compiled;
        if (!source.includes(GAIN_OUTPUT)) {
            throw new Error('supersaw-unison.dsp no longer applies gain at the output stage this pin reverts');
        }
        const preGain = await compileEffectFreeFaustPolyDsp(
            compiler,
            'Supersaw_Unison_Pre_Gain',
            source.replace(GAIN_OUTPUT, PRE_GAIN_OUTPUT),
            '-I libraries/'
        );
        if (!preGain) {
            throw new Error('the pre-gain supersaw must compile as a poly instrument');
        }
        preGainPoly = preGain;
    }, COMPILE_TIMEOUT_MS);

    async function renderAtVelocity(generator: FaustPolyDspGeneratorType, velocity: number): Promise<Float32Array> {
        const processor: IFaustPolyOfflineProcessor = await generator.createOfflineProcessor(
            SAMPLE_RATE,
            BLOCK_SIZE,
            VOICES
        );
        processor.start();
        processor.keyOn(0, 69, velocity);
        const outputs = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));
        const rendered = new Float32Array(RENDER_BLOCKS * BLOCK_SIZE);
        for (let block = 0; block < RENDER_BLOCKS; block++) {
            processor.compute([], outputs);
            rendered.set(outputs[0] ?? new Float32Array(BLOCK_SIZE), block * BLOCK_SIZE);
        }
        return rendered;
    }

    function peakOf(samples: Float32Array): number {
        return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    }

    it('plays a velocity-20 note at 20/127 of a velocity-127 note', async () => {
        const loud = peakOf(await renderAtVelocity(poly, 127));
        const soft = peakOf(await renderAtVelocity(poly, 20));

        expect(loud).toBeGreaterThan(0.05);
        expect(soft / loud).toBeCloseTo(20 / 127, 3);
    });

    it('plays a full-velocity note exactly as the supersaw did before it declared gain', async () => {
        // A saved project's notes at velocity 127 keep their level: the allocator
        // writes gain 127/127 = 1, a multiply by one.
        const current = await renderAtVelocity(poly, 127);
        const preGain = await renderAtVelocity(preGainPoly, 127);

        expect(peakOf(preGain)).toBeGreaterThan(0.05);
        expect(Array.from(current)).toEqual(Array.from(preGain));
    });
});
