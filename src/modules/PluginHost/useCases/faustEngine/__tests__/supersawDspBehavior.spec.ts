// @vitest-environment node
import { readFileSync } from 'node:fs';

import {
    FaustMonoDspGenerator,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';

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
