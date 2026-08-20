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
 * Behavior proof for brick-wall-limiter.dsp (#2300). The file shipped as
 * `process = co.limiter_1176_R4_stereo;` — fixed characteristics, no
 * `hslider` — while the device UI exposed ceiling and release. Each control
 * now has to be shown doing the thing its name promises: the ceiling has to
 * actually bound the output, the release has to change how fast gain returns,
 * and the look-ahead has to delay the signal it is looking ahead of.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/brick-wall-limiter.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const TOTAL_S = 1;

const PREFIX = '/Brick-Wall_Limiter';

type Settings = Record<string, number>;

function dbToLinear(db: number): number {
    return 10 ** (db / 20);
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

function peakBetween(output: Float32Array, fromS: number, toS: number): number {
    let peak = 0;
    for (let n = Math.floor(fromS * SAMPLE_RATE); n < Math.floor(toS * SAMPLE_RATE); n++) {
        peak = Math.max(peak, Math.abs(output[n] ?? 0));
    }
    return peak;
}

/** Loud 220 Hz tone, well above any ceiling under test. */
function loud(n: number): number {
    return 0.9 * Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE);
}

/** 0.9 for the first BURST_END_S, then 0.05 — the release test signal. */
const BURST_END_S = 0.4;
function burstThenQuiet(n: number): number {
    const amplitude = n < BURST_END_S * SAMPLE_RATE ? 0.9 : 0.05;
    return amplitude * Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE);
}

/** Silence, then a loud tone from ONSET_S — used to measure look-ahead delay. */
const ONSET_S = 0.2;
function silenceThenLoud(n: number): number {
    return n < ONSET_S * SAMPLE_RATE ? 0 : loud(n);
}

/**
 * Silence, then a full-scale 1 kHz cosine from TRANSIENT_S — a genuine
 * transient that jumps to 1.0 on its first sample, not a sine easing up
 * through the ceiling.
 */
const TRANSIENT_S = 0.1;
function silenceThenTransient(n: number): number {
    if (n < TRANSIENT_S * SAMPLE_RATE) {
        return 0;
    }
    return Math.cos((2 * Math.PI * 1000 * (n - TRANSIENT_S * SAMPLE_RATE)) / SAMPLE_RATE);
}

/**
 * MAX_LOOKAHEAD_S in the DSP, in samples at this spec's rate. The device
 * delays its output by exactly this much at every `lookahead` setting.
 */
const MAX_LOOKAHEAD_SAMPLES = 0.01 * SAMPLE_RATE;

/**
 * A quiet tone under the ceiling throughout, with the same full-scale
 * transient laid on top from TRANSIENT_S. The quiet part is what a look-ahead
 * gain reduction lands on before the transient it was computed from arrives.
 */
const QUIET_AMPLITUDE = 0.05;
function quietThenTransient(n: number): number {
    return QUIET_AMPLITUDE * Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE) + silenceThenTransient(n);
}

/** The only place the output meets the ceiling, so it can be lifted for a test render. */
const CLIP_EXPRESSION = 'max(0 - ceiling_linear, min(ceiling_linear, delayed(x) * gain))';
const UNCLIPPED_EXPRESSION = 'delayed(x) * gain';

function firstSampleAbove(output: Float32Array, level: number): number {
    for (let n = 0; n < output.length; n++) {
        if (Math.abs(output[n] ?? 0) > level) {
            return n;
        }
    }
    return -1;
}

describe('brick-wall-limiter.dsp behavior (offline render)', () => {
    let generator: FaustMonoDspGeneratorType;
    /** The shipped DSP with the final clip lifted, to size what the clip removes. */
    let unclippedGenerator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'Brick-Wall_Limiter', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('brick-wall-limiter.dsp must compile');
        }
        generator = created;

        // Guards the substitution: if the clip is ever reworded, this fails
        // rather than silently comparing the shipped DSP against itself.
        if (!dspCode.includes(CLIP_EXPRESSION)) {
            throw new Error(`brick-wall-limiter.dsp no longer contains "${CLIP_EXPRESSION}"`);
        }
        const unclippedCode = dspCode.replace(CLIP_EXPRESSION, UNCLIPPED_EXPRESSION);
        const unclipped = new FaustMonoDspGenerator();
        const unclippedCompiled = await unclipped.compile(
            compiler,
            'Brick-Wall_Limiter',
            unclippedCode,
            '-I libraries/'
        );
        if (!unclippedCompiled) {
            throw new Error('the unclipped variant must compile');
        }
        unclippedGenerator = unclipped;
    }, COMPILE_TIMEOUT_MS);

    it('holds the output under whatever ceiling is set', async () => {
        for (const ceiling of [-12, -6, -0.3, 0]) {
            const output = await render(generator, loud, { ceiling, release: 100, lookahead: 5 });
            // Steady state, past the first envelope rise.
            const peak = peakBetween(output, 0.1, TOTAL_S);
            expect(peak, `${ceiling} dB ceiling`).toBeLessThanOrEqual(dbToLinear(ceiling) + 1e-6);
            // And it is limiting, not muting: a limiter that output silence
            // would satisfy the bound above. Above the input's own 0.9 peak
            // there is nothing to limit, so that is the bound at 0 dB.
            expect(peak, `${ceiling} dB ceiling`).toBeGreaterThan(Math.min(0.9, dbToLinear(ceiling)) * 0.95);
        }
    });

    it('separates two ceilings that used to produce identical output', async () => {
        const low = await render(generator, loud, { ceiling: -12, release: 100, lookahead: 5 });
        const high = await render(generator, loud, { ceiling: -0.3, release: 100, lookahead: 5 });

        expect(peakBetween(high, 0.1, TOTAL_S)).toBeGreaterThan(peakBetween(low, 0.1, TOTAL_S) * 3);
    });

    it('recovers gain at the release time after the loud part ends', async () => {
        const settings = { ceiling: -12, lookahead: 5 };
        const fast = await render(generator, burstThenQuiet, { ...settings, release: 1 });
        const slow = await render(generator, burstThenQuiet, { ...settings, release: 1000 });

        // The quiet tail is 0.05, far below the -12 dB (0.251) ceiling, so a
        // recovered limiter passes it untouched.
        const window: [number, number] = [BURST_END_S + 0.01, BURST_END_S + 0.05];
        expect(peakBetween(fast, ...window)).toBeGreaterThan(0.045);
        // A 1 s release has barely moved 50 ms in, so the burst's ~0.28 gain
        // still holds the tail down.
        expect(peakBetween(slow, ...window)).toBeLessThan(0.02);
    });

    it('keeps the final clip a safety net rather than the limiting mechanism', async () => {
        // The gain is smoothed, so it is always slightly behind the true peak
        // when that peak arrives at the delayed output, and the clip removes
        // the difference. That difference is hard clipping — broadband
        // distortion on every transient — on the one device a user reaches for
        // to avoid exactly that. The first cut of this DSP left 2.78 dB of it,
        // and no other test here could see that: the steady-state ceiling
        // checks measure a settled sine, and the ceiling holds either way,
        // which is precisely how a clipper doing all the work stays invisible.
        const settings = { ceiling: -6, release: 100, lookahead: 10 };
        const shipped = await render(generator, silenceThenTransient, settings);
        const unclipped = await render(unclippedGenerator, silenceThenTransient, settings);

        const window: [number, number] = [TRANSIENT_S, TRANSIENT_S + 0.1];
        const ceilingLinear = dbToLinear(-6);
        const preClipPeak = peakBetween(unclipped, ...window);

        // The transient really does drive the limiter: without this the test
        // would pass on a signal the limiter never touches.
        expect(preClipPeak).toBeGreaterThan(ceilingLinear * 0.99);

        const overshootDb = 20 * Math.log10(preClipPeak / ceilingLinear);
        expect(overshootDb, 'pre-clip overshoot').toBeLessThan(0.02);

        let removed = 0;
        for (let n = Math.floor(window[0] * SAMPLE_RATE); n < Math.floor(window[1] * SAMPLE_RATE); n++) {
            removed = Math.max(removed, Math.abs((shipped[n] ?? 0) - (unclipped[n] ?? 0)));
        }
        // Measured 0.0091 dB / 0.105% of the peak; the bound leaves headroom
        // without letting the clipper creep back into doing the work.
        expect(removed, 'peak amplitude removed by the clip').toBeLessThan(ceilingLinear * 0.003);
    });

    it('delays the output by MAX_LOOKAHEAD whatever the look-ahead is set to', async () => {
        // The device's own latency has to be a constant, because the engine
        // reports it once at create and every scheduling decision downstream —
        // clips, notes, automation, a frozen render — is planned against that
        // one number. A delay that tracked the knob would misalign this track
        // against every other one the moment the knob moved, and would go
        // unreported entirely when an automation lane moved it. So the signal
        // path is delayed by MAX_LOOKAHEAD always, and the look-ahead is spent
        // on the detector side instead.
        const settings = { ceiling: -6, release: 100 };
        const none = await render(generator, silenceThenLoud, { ...settings, lookahead: 0 });
        const half = await render(generator, silenceThenLoud, { ...settings, lookahead: 5 });
        const full = await render(generator, silenceThenLoud, { ...settings, lookahead: 10 });

        const inputOnset = ONSET_S * SAMPLE_RATE;
        const onsetNone = firstSampleAbove(none, 1e-4);
        const onsetHalf = firstSampleAbove(half, 1e-4);
        const onsetFull = firstSampleAbove(full, 1e-4);

        // 10 ms at 48 kHz is 480 samples. Allow a couple for the sine's own
        // ramp through the detection threshold — not enough to hide a delay
        // that moved with the control, which would be 240 samples per 5 ms.
        for (const [label, onset] of [
            ['lookahead 0', onsetNone],
            ['lookahead 5', onsetHalf],
            ['lookahead 10', onsetFull],
        ] as const) {
            expect(onset - inputOnset, `${label} output delay`).toBeGreaterThan(MAX_LOOKAHEAD_SAMPLES - 4);
            expect(onset - inputOnset, `${label} output delay`).toBeLessThan(MAX_LOOKAHEAD_SAMPLES + 4);
        }

        // Both still obey the ceiling — look-ahead changes how the gain gets
        // there, never whether the wall holds.
        expect(peakBetween(full, 0.25, TOTAL_S)).toBeLessThanOrEqual(dbToLinear(-6) + 1e-6);
    });

    it('still lets the detector lead the output by the look-ahead time', async () => {
        // The constant output delay must not have cost the control its job.
        // Look-ahead is visible as the duck that lands on the quiet material
        // immediately BEFORE a transient: with 10 ms of it the gain has already
        // come down by the time that material reaches the output, and with none
        // the gain moves only when the transient itself arrives.
        const settings = { ceiling: -6, release: 100 };
        const none = await render(generator, quietThenTransient, { ...settings, lookahead: 0 });
        const full = await render(generator, quietThenTransient, { ...settings, lookahead: 10 });

        // Output time TRANSIENT_S + 4 ms carries input from 6 ms BEFORE the
        // transient — quiet tone, in both renders — and the transient itself
        // does not arrive until TRANSIENT_S + 10 ms.
        const window: [number, number] = [TRANSIENT_S + 0.004, TRANSIENT_S + 0.0095];
        const undulled = peakBetween(none, ...window);
        const ducked = peakBetween(full, ...window);

        // Untouched at zero look-ahead: this is the quiet tone at its own level.
        expect(undulled, 'no look-ahead').toBeGreaterThan(QUIET_AMPLITUDE * 0.9);
        // The 10 ms render has the transient's own gain reduction already
        // applied to it, which at a -6 dB ceiling against a full-scale peak is
        // a little over 6 dB.
        expect(ducked, 'full look-ahead').toBeLessThan(undulled * 0.7);
    });
});
