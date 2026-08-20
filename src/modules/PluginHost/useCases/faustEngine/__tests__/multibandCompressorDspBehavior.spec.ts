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

/** Both output channels, for the checks that compare the stereo link. */
async function renderStereo(
    generator: FaustMonoDspGeneratorType,
    channels: readonly ((n: number) => number)[],
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
    return { left, right };
}

/** Gain reduction that counts as "the band has started working". */
const GAIN_REDUCTION_KNEE_DB = 0.5;

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

    it('detects the true per-channel level, not the sum of both channels', async () => {
        // `co.compressor_stereo` detects on `abs(x)+abs(y)`, so a centred
        // (L == R) signal presents 2A where a hard-panned one presents A —
        // exactly +6.02 dB — and the band starts compressing that much early.
        // At ratio 3 that is 6.02 * (1 - 1/3) = 4.01 dB of gain reduction the
        // user never asked for, and it appears and disappears with the source's
        // own stereo width, so no threshold knob means dBFS.
        const tone = sine(400, 0.5);
        const silence = (): number => 0;
        const settings: Settings = {
            ...OPEN,
            mid_threshold: -20,
            crossover_low: 200,
            crossover_high: 3000,
        };
        const centred = await renderStereo(generator, [tone, tone], settings);
        const panned = await renderStereo(generator, [tone, silence], settings);

        // Left carries the identical waveform in both renders, so its output
        // level is the band's gain and nothing else.
        const centredGainDb = 20 * Math.log10(outputRms(centred.left) / inputRms(tone));
        const pannedGainDb = 20 * Math.log10(outputRms(panned.left) / inputRms(tone));

        // Both are being compressed — otherwise the comparison is between two
        // untouched renders and proves nothing.
        expect(pannedGainDb, 'panned gain reduction').toBeLessThan(-3);
        expect(Math.abs(centredGainDb - pannedGainDb), 'centred vs panned gain').toBeLessThan(0.2);
    });

    it('starts compressing a centred sine no earlier than the threshold it declares', async () => {
        // The absolute claim: the knee is where the knob says it is, in dBFS,
        // for the stereo material a master bus actually carries.
        //
        // Two residuals push the measured knee LATE and are stock JOS
        // compressor behaviour, shared by every Faust compressor here: the
        // `an.amp_follower_ar` detector settles about a dB under a sine's peak
        // at these attack/release times, and near the knee only the ripple
        // peaks clear `max(level - thresh, 0)` before `kneesmooth` averages
        // them. The stereo-sum defect pushes the knee the other way — 6.02 dB
        // EARLY on centred material — so the direction is what makes this
        // discriminating, and the bound catches a residual that grows.
        const threshold = -20;
        const settings: Settings = {
            ...OPEN,
            mid_threshold: threshold,
            crossover_low: 200,
            crossover_high: 3000,
        };

        let kneeDb: number | null = null;
        for (let levelDb = -32; levelDb <= -8; levelDb += 0.5) {
            const amplitude = 10 ** (levelDb / 20);
            const tone = sine(400, amplitude);
            const rendered = await renderStereo(generator, [tone, tone], settings);
            const gainDb = 20 * Math.log10(outputRms(rendered.left) / inputRms(tone));
            if (gainDb < -GAIN_REDUCTION_KNEE_DB) {
                kneeDb = levelDb;
                break;
            }
        }

        expect(kneeDb, 'no gain reduction found across the sweep').not.toBeNull();
        expect(kneeDb!, 'knee is early — the detector is reading above the true level').toBeGreaterThan(threshold - 1);
        expect(kneeDb!, 'knee is late').toBeLessThan(threshold + 3);
    });

    it('reduces gain by what the declared threshold and ratio predict for a centred dBFS level', async () => {
        // The knee sweep bounds where compression starts; this bounds how much
        // of it there is once it has, which is the claim a mastering engineer
        // actually reads off the knob. Well above the threshold the ripple
        // effects are gone and only the compression law is left:
        //   GR(dB) = (level - threshold) * (1 - 1/ratio)
        // 775 Hz is the geometric centre of the default mid band, so the low
        // and high legs contribute about -47 dB each and the measurement is the
        // mid band's gain and essentially nothing else.
        //
        // The stereo-sum defect adds 6.02 dB to `level` for centred material,
        // which at ratio 3 is 4.01 dB of gain reduction nobody asked for.
        const threshold = -30;
        const levelDb = -14;
        const expectedGainReductionDb = (levelDb - threshold) * (1 - 1 / 3);
        const tone = sine(775, 10 ** (levelDb / 20));

        const rendered = await renderStereo(generator, [tone, tone], {
            ...OPEN,
            mid_threshold: threshold,
            crossover_low: 200,
            crossover_high: 3000,
        });

        const measuredDb = -20 * Math.log10(outputRms(rendered.left) / inputRms(tone));
        expect(Math.abs(measuredDb - expectedGainReductionDb), `${measuredDb} dB of gain reduction`).toBeLessThan(2);
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
