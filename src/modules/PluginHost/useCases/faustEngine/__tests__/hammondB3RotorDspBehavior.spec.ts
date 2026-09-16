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
 * Behavior proof for hammond-b3.dsp rotary modulation (#3783):
 *
 * Defect:
 * Hammond B3's right rotary modulation adds 1.5708 to oscillator frequency:
 *   leslie_r = ... * (1.0 + leslie_depth * os.osc(leslie_speed + 1.5708));
 * instead of applying a 90-degree (pi/2) phase offset:
 *   leslie_r = ... * (1.0 + leslie_depth * os.oscp(leslie_speed, ma.PI * 0.5));
 *
 * At a 6 Hz Leslie speed the channels therefore modulated at 6 Hz (Left) and
 * 7.5708 Hz (Right), producing an uncoupled drift rather than a shared rotor.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/hammond-b3.dsp';
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

async function renderHammondStereo(
    generator: FaustMonoDspGeneratorType,
    sampleRate: number,
    settings: Settings,
    durationS = 4.0,
    blockSize = 128
): Promise<{ left: Float32Array; right: Float32Array }> {
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

    for (let start = 0; start < total; start += blockSize) {
        processor.compute(inputs, block);
        for (let i = 0; i < blockSize; i++) {
            if (start + i < total) {
                left[start + i] = block[0]?.[i] ?? 0;
                right[start + i] = block[1]?.[i] ?? 0;
            }
        }
    }
    return { left, right };
}

type ComplexComponent = {
    re: number;
    im: number;
    magnitude: number;
    phase: number;
};

function computeFourierComponent(
    samples: Float32Array,
    sampleRate: number,
    targetFreq: number,
    startSample: number,
    endSample: number
): ComplexComponent {
    const nSamples = endSample - startSample;
    if (nSamples <= 0) {
        return { re: 0, im: 0, magnitude: 0, phase: 0 };
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
    const magnitude = Math.hypot(re, im);
    const phase = Math.atan2(im, re);
    return { re, im, magnitude, phase };
}

describe('hammond-b3.dsp stereo rotor modulation (#3783)', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'hammond_b3', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('hammond-b3.dsp must compile');
        }
        generator = created;

        const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
        extractAddresses(json.ui ?? []);
    }, COMPILE_TIMEOUT_MS);

    it('both channels modulate at the exact same rotor speed (6 Hz sideband, no 7.5708 Hz spurious component)', async () => {
        const sampleRate = 48_000;
        const { left, right } = await renderHammondStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            gain: 1,
            drawbar_16: 0,
            drawbar_8: 8,
            drawbar_513: 0,
            drawbar_4: 0,
            drawbar_223: 0,
            drawbar_2: 0,
            drawbar_135: 0,
            drawbar_113: 0,
            drawbar_1: 0,
            click: 0,
            percussion: 0,
            leslie_speed: 6.0,
            leslie_depth: 0.8,
        });

        // Analyze final 3 seconds (sample 48000 to 192000)
        const startSample = 48_000;
        const endSample = 48_000 * 4;

        // At 6 Hz modulation on a 440 Hz carrier:
        // Expected lower sideband is 440 - 6 = 434 Hz
        // The defective right channel modulated at 6 + 1.5708 = 7.5708 Hz, giving 440 - 7.5708 = 432.4292 Hz
        const leftTarget = computeFourierComponent(left, sampleRate, 434, startSample, endSample);
        const rightTarget = computeFourierComponent(right, sampleRate, 434, startSample, endSample);

        const leftSpurious = computeFourierComponent(left, sampleRate, 432.4292, startSample, endSample);
        const rightSpurious = computeFourierComponent(right, sampleRate, 432.4292, startSample, endSample);

        // Left channel has 434 Hz sideband and no 432.4292 Hz sideband
        expect(leftTarget.magnitude).toBeGreaterThan(0.04);
        expect(leftSpurious.magnitude).toBeLessThan(0.005);

        // Right channel MUST ALSO have 434 Hz sideband and NO 432.4292 Hz sideband
        expect(rightTarget.magnitude).toBeGreaterThan(0.04);
        expect(rightSpurious.magnitude).toBeLessThan(0.005);
    });

    it('maintains 90-degree phase relationship between Left and Right rotor modulations', async () => {
        const sampleRate = 48_000;
        const { left, right } = await renderHammondStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            gain: 1,
            drawbar_16: 0,
            drawbar_8: 8,
            drawbar_513: 0,
            drawbar_4: 0,
            drawbar_223: 0,
            drawbar_2: 0,
            drawbar_135: 0,
            drawbar_113: 0,
            drawbar_1: 0,
            click: 0,
            percussion: 0,
            leslie_speed: 6.0,
            leslie_depth: 0.8,
        });

        const startSample = 48_000;
        const endSample = 48_000 * 4;

        const leftSideband = computeFourierComponent(left, sampleRate, 434, startSample, endSample);
        const rightSideband = computeFourierComponent(right, sampleRate, 434, startSample, endSample);

        // The phase difference between the lower sidebands reflects the modulation phase offset
        // Wrapping phase difference to [-PI, PI]
        let phaseDiff = rightSideband.phase - leftSideband.phase;
        while (phaseDiff > Math.PI) {
            phaseDiff -= 2 * Math.PI;
        }
        while (phaseDiff < -Math.PI) {
            phaseDiff += 2 * Math.PI;
        }

        // Target phase offset is pi/2 (or -pi/2 depending on sideband demodulation sign)
        // |phaseDiff| should be close to pi / 2 (approx 1.57 rad)
        expect(Math.abs(phaseDiff)).toBeCloseTo(Math.PI / 2, 1);
    });

    it('shares rotor speed across different speed settings (e.g. 1.5 Hz slow, 8.0 Hz fast)', async () => {
        const sampleRate = 48_000;
        for (const speed of [1.5, 8.0]) {
            const { left, right } = await renderHammondStereo(generator, sampleRate, {
                freq: 440,
                gate: 1,
                gain: 1,
                drawbar_16: 0,
                drawbar_8: 8,
                click: 0,
                percussion: 0,
                leslie_speed: speed,
                leslie_depth: 0.8,
            });

            const startSample = 48_000;
            const endSample = 48_000 * 4;

            const targetFreq = 440 - speed;
            const leftTarget = computeFourierComponent(left, sampleRate, targetFreq, startSample, endSample);
            const rightTarget = computeFourierComponent(right, sampleRate, targetFreq, startSample, endSample);

            expect(leftTarget.magnitude).toBeGreaterThan(0.03);
            expect(rightTarget.magnitude).toBeGreaterThan(0.03);

            // Spurious speed + 1.5708 Hz component must not be present on either channel
            const spuriousFreq = 440 - (speed + 1.5708);
            const rightSpurious = computeFourierComponent(right, sampleRate, spuriousFreq, startSample, endSample);
            expect(rightSpurious.magnitude).toBeLessThan(0.005);
        }
    });

    it('maintains shared rotor frequency across sample rates (44.1 kHz, 96 kHz)', async () => {
        for (const sampleRate of [44_100, 96_000]) {
            const { left, right } = await renderHammondStereo(generator, sampleRate, {
                freq: 440,
                gate: 1,
                gain: 1,
                drawbar_16: 0,
                drawbar_8: 8,
                click: 0,
                percussion: 0,
                leslie_speed: 6.0,
                leslie_depth: 0.8,
            });

            const startSample = sampleRate;
            const endSample = sampleRate * 4;

            const leftTarget = computeFourierComponent(left, sampleRate, 434, startSample, endSample);
            const rightTarget = computeFourierComponent(right, sampleRate, 434, startSample, endSample);

            expect(leftTarget.magnitude).toBeGreaterThan(0.03);
            expect(rightTarget.magnitude).toBeGreaterThan(0.03);
        }
    });

    it('leslie_depth = 0 removes modulation entirely and outputs identical channels', async () => {
        const sampleRate = 48_000;
        const { left, right } = await renderHammondStereo(generator, sampleRate, {
            freq: 440,
            gate: 1,
            gain: 1,
            drawbar_16: 0,
            drawbar_8: 8,
            click: 0,
            percussion: 0,
            leslie_speed: 6.0,
            leslie_depth: 0.0,
        });

        // When depth is 0, both channels are (tonewheel) * (1.0 + 0) * env * gain
        // They must be bit-identical
        let maxDiff = 0;
        for (let i = 0; i < left.length; i++) {
            const diff = Math.abs((left[i] ?? 0) - (right[i] ?? 0));
            if (diff > maxDiff) {
                maxDiff = diff;
            }
        }
        expect(maxDiff).toBe(0);

        // And no sideband at 434 Hz
        const leftSideband = computeFourierComponent(left, sampleRate, 434, 48_000, 48_000 * 4);
        expect(leftSideband.magnitude).toBeLessThan(0.001);
    });
});
