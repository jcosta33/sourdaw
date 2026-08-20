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
 * Behavior proof for the three built-ins that #2300's cross-check found
 * drifting once it compared EVERY declared address against the compiled node,
 * not just the two devices the report named:
 *
 *  - `/tape_delay/tone` was declared with no `hslider` behind it at all;
 *  - `/Gain_Utility/invert_phase` had a checkbox that Faust folded away,
 *    because it was bound to `ba.if`'s last argument rather than its
 *    condition, so the compiled node carried no such parameter;
 *  - lufs-meter.dsp metered each channel separately, giving two parameters
 *    named `momentary` and two named `short_term`; faustDeviceFactory keys by
 *    the last path segment and keeps the first, so the reachable reading was
 *    the left channel's, not the BS.1770 programme loudness it claims.
 */

const COMPILE_TIMEOUT_MS = 120_000;
const DSP_DIR = 'src/modules/PluginHost/useCases/faustEngine/dsp';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;

type Settings = Record<string, number>;

type Rendered = {
    left: Float32Array;
    right: Float32Array;
    paramValues: Record<string, number>;
};

async function compile(file: string, processorName: string): Promise<FaustMonoDspGeneratorType> {
    const compiler = await loadFaustCompilerForSpec();
    const generator = new FaustMonoDspGenerator();
    const compiled = await generator.compile(
        compiler,
        processorName,
        readFileSync(`${DSP_DIR}/${file}`, 'utf8'),
        '-I libraries/'
    );
    if (!compiled) {
        throw new Error(`${file} must compile`);
    }
    return generator;
}

async function render(
    generator: FaustMonoDspGeneratorType,
    prefix: string,
    channels: readonly ((n: number) => number)[],
    seconds: number,
    settings: Settings,
    readBack: readonly string[] = []
): Promise<Rendered> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        processor.setParamValue(`${prefix}/${name}`, value);
    }

    const inputs = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));

    const total = Math.floor(seconds * SAMPLE_RATE);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    for (let start = 0; start < total; start += BLOCK_SIZE) {
        for (const [channel, samples] of inputs.entries()) {
            const source = channels[channel] ?? (() => 0);
            for (let i = 0; i < BLOCK_SIZE; i++) {
                samples[i] = source(start + i);
            }
        }
        processor.compute(inputs, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            left[start + i] = block[0]?.[i] ?? 0;
            right[start + i] = block[1]?.[i] ?? 0;
        }
    }

    const paramValues: Record<string, number> = {};
    for (const name of readBack) {
        paramValues[name] = processor.getParamValue(`${prefix}/${name}`);
    }
    return { left, right, paramValues };
}

function sine(frequency: number, amplitude: number): (n: number) => number {
    return (n) => amplitude * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
}

/** The unprocessed input as a buffer, so `rms` can measure it the same way. */
function referenceOf(source: (n: number) => number, seconds: number): Float32Array {
    const total = Math.floor(seconds * SAMPLE_RATE);
    const buffer = new Float32Array(total);
    for (let n = 0; n < total; n++) {
        buffer[n] = source(n);
    }
    return buffer;
}

function rms(output: Float32Array, fromS: number, toS: number): number {
    const from = Math.floor(fromS * SAMPLE_RATE);
    const to = Math.floor(toS * SAMPLE_RATE);
    let energy = 0;
    for (let n = from; n < to; n++) {
        energy += (output[n] ?? 0) ** 2;
    }
    return Math.sqrt(energy / (to - from));
}

describe('gain-utility.dsp invert_phase', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        generator = await compile('gain-utility.dsp', 'Gain_Utility');
    }, COMPILE_TIMEOUT_MS);

    it('inverts polarity when the checkbox is on and leaves it alone when off', async () => {
        const input = sine(440, 0.4);
        const source = [input, input];
        const straight = await render(generator, '/Gain_Utility', source, 0.2, { invert_phase: 0 });
        const inverted = await render(generator, '/Gain_Utility', source, 0.2, { invert_phase: 1 });

        // Sample-for-sample negation, not merely "different".
        for (let n = 1000; n < 1100; n++) {
            expect(straight.left[n]).toBeCloseTo(input(n), 5);
            expect(inverted.left[n]).toBeCloseTo(-input(n), 5);
        }
    });
});

describe('1176-compressor.dsp stereo detection', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        generator = await compile('1176-compressor.dsp', '1176_Compressor');
    }, COMPILE_TIMEOUT_MS);

    it('detects the true per-channel level, not the sum of both channels', async () => {
        // Inherited from `co.compressor_stereo`, whose detector is
        // `abs(x)+abs(y)`: centred material presents 2A where the same signal
        // panned hard presents A, so the declared dB threshold fired up to
        // 6.02 dB early depending only on how wide the source was.
        const tone = sine(500, 0.5);
        const silence = (): number => 0;
        const settings = { ratio: 4, threshold: -20, attack: 0.001, release: 0.1 };
        const centred = await render(generator, '/1176_Compressor', [tone, tone], 1, settings);
        const panned = await render(generator, '/1176_Compressor', [tone, silence], 1, settings);

        // Left carries the identical waveform in both renders, so its level is
        // the compression gain and nothing else.
        const centredGainDb = 20 * Math.log10(rms(centred.left, 0.6, 1) / rms(referenceOf(tone, 1), 0.6, 1));
        const pannedGainDb = 20 * Math.log10(rms(panned.left, 0.6, 1) / rms(referenceOf(tone, 1), 0.6, 1));

        expect(pannedGainDb, 'panned gain reduction').toBeLessThan(-3);
        expect(Math.abs(centredGainDb - pannedGainDb), 'centred vs panned gain').toBeLessThan(0.2);
    });
});

describe('tape-delay.dsp tone', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        generator = await compile('tape-delay.dsp', 'Tape_Delay');
    }, COMPILE_TIMEOUT_MS);

    it('darkens the repeats as the tone control closes', async () => {
        // 6 kHz burst, 100% wet, short delay with strong feedback: by 0.4 s the
        // output is repeats only, so what survives is what the tone filter in
        // the feedback loop let through.
        const burst = (n: number): number => (n < 0.05 * SAMPLE_RATE ? sine(6000, 0.5)(n) : 0);
        const settings = { delay: 0.05, feedback: 0.85, dry_wet: 1 };
        const open = await render(generator, '/Tape_Delay', [burst, burst], 0.8, { ...settings, tone: 12_000 });
        const dark = await render(generator, '/Tape_Delay', [burst, burst], 0.8, { ...settings, tone: 500 });

        const openTail = rms(open.left, 0.4, 0.8);
        const darkTail = rms(dark.left, 0.4, 0.8);
        expect(openTail).toBeGreaterThan(0.001);
        expect(darkTail).toBeLessThan(openTail * 0.1);
    });
});

describe('lufs-meter.dsp programme loudness', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        generator = await compile('lufs-meter.dsp', 'LUFS_Meter');
    }, COMPILE_TIMEOUT_MS);

    it('sums both channels, so correlated stereo reads 3 dB above one channel alone', async () => {
        const tone = sine(1000, 0.5);
        const silence = (): number => 0;
        const readBack = ['momentary', 'short_term'];
        const stereo = await render(generator, '/LUFS_Meter', [tone, tone], 4, {}, readBack);
        const leftOnly = await render(generator, '/LUFS_Meter', [tone, silence], 4, {}, readBack);

        // BS.1770 weights L and R at G = 1.0 and sums their mean squares, so
        // duplicating one channel adds exactly 10*log10(2).
        expect(stereo.paramValues.momentary! - leftOnly.paramValues.momentary!).toBeCloseTo(3.01, 1);
        expect(stereo.paramValues.short_term! - leftOnly.paramValues.short_term!).toBeCloseTo(3.01, 1);
    });

    it('reads a 1 kHz sine at its own dBFS level, as BS.1770 is calibrated to', async () => {
        // The standard's own calibration point: the -0.691 offset exists so a
        // 1 kHz sine cancels the K-weighting gain exactly. One channel at
        // -23 dBFS RMS reads -23 LUFS; the same sine in both channels reads
        // 3.01 dB higher, because L and R are summed at unity weight.
        //
        // Rewriting a measurement device is how a meter ends up quietly 3 dB
        // out while looking completely normal, so this pins the absolute
        // number, not just the stereo/mono difference.
        const amplitude = Math.SQRT2 * 10 ** (-23 / 20);
        const tone = sine(1000, amplitude);
        const silence = (): number => 0;
        // The short-term window is a 3 s time constant, so it needs a long
        // render to settle; momentary's 0.4 s settles inside the same one.
        const settleSeconds = 24;
        const readBack = ['momentary', 'short_term'];
        const oneChannel = await render(generator, '/LUFS_Meter', [tone, silence], settleSeconds, {}, readBack);
        const bothChannels = await render(generator, '/LUFS_Meter', [tone, tone], settleSeconds, {}, readBack);

        expect(oneChannel.paramValues.momentary!).toBeCloseTo(-23, 1);
        expect(oneChannel.paramValues.short_term!).toBeCloseTo(-23, 1);
        expect(bothChannels.paramValues.momentary!).toBeCloseTo(-20, 1);
        expect(bothChannels.paramValues.short_term!).toBeCloseTo(-20, 1);
    });

    it('passes audio through untouched', async () => {
        const tone = sine(1000, 0.5);
        const other = sine(300, 0.3);
        const rendered = await render(generator, '/LUFS_Meter', [tone, other], 0.2, {});

        for (let n = 1000; n < 1100; n++) {
            expect(rendered.left[n]).toBeCloseTo(tone(n), 5);
            expect(rendered.right[n]).toBeCloseTo(other(n), 5);
        }
    });
});
