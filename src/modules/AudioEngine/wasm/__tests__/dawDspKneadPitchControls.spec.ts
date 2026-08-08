/**
 * Knead's two per-clip pitch-correction controls, measured through the
 * checked-in wasm rather than argued about in TypeScript.
 *
 * `retuneSpeedMs` and `formantPreserve` live on `KneadClipState`, ride the
 * `syncKneadState` payload all the way to the worklet port, and — before this
 * file existed — were dropped there: `kneadProcessor.ts`'s `KneadClip` type
 * declared four blob fields and nothing else, and the only engine write in the
 * whole processor was `set_shift_semitones`. The Rust side had no other setter
 * to write to. Both sliders moved between their extremes and rendered the same
 * audio.
 *
 * The claim each test makes is the one that matters for a dead control:
 * **moving it changes rendered output**, measured off the engine's own render,
 * not off a setter having been called or a name appearing in a table.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initSync, KneadInstance } from '../daw_dsp.js';

const SAMPLE_RATE = 48_000;
const FRAMES = 128;
/** Source fundamental. Low enough that a +7 st shift stays well inside YIN's range. */
const SOURCE_HZ = 200;
/** Centre of the synthetic vowel's spectral envelope — the "formant". */
const FORMANT_HZ = 1_200;
const SHIFT_SEMITONES = 7;
const SHIFT_RATIO = 2 ** (SHIFT_SEMITONES / 12);
/** The engine's analysis frame; the granularity the retune glide steps at. */
const ANALYSIS_FRAME = 2_048;
/**
 * Explicit per-test budget, well over the ~3 s each of these takes on an idle
 * box. Every test here renders seconds of audio through the real wasm and then
 * runs a naive DFT or autocorrelation over it, so the 5 s default is close
 * enough to the real cost that a loaded machine reds them for arithmetic that
 * has not changed — which is a broken *guard*, not a broken engine.
 */
const RENDER_TIMEOUT_MS = 60_000;

const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

type KneadRenderInput = {
    /** Blocks rendered before the shift target moves off zero. `null` never steps. */
    stepAtBlock: number | null;
    retuneSpeedMs: number;
    formantPreserve: boolean;
    blocks: number;
    /** Shift held for the whole render when `stepAtBlock` is null. */
    heldShift?: number;
};

/**
 * A pulse-like tone whose harmonic amplitudes are shaped by a Gaussian centred
 * on {@link FORMANT_HZ}: fundamental and spectral envelope are independent by
 * construction, which is the pair `formantPreserve` decides the coupling of.
 */
const VOWEL_PERIOD = SAMPLE_RATE / SOURCE_HZ;
const VOWEL_TABLE = ((): Float32Array => {
    // `SOURCE_HZ` divides `SAMPLE_RATE` exactly, so one period is a whole
    // number of samples and the table tiles the render seamlessly. Built once
    // rather than per sample: every render below is ~10^5 samples long and
    // this sum runs over ~10^2 harmonics.
    const harmonics = Math.floor((SAMPLE_RATE * 0.45) / SOURCE_HZ);
    const table = new Float32Array(VOWEL_PERIOD);
    for (let index = 0; index < VOWEL_PERIOD; index++) {
        let sum = 0;
        for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
            const freq = SOURCE_HZ * harmonic;
            const amplitude = Math.exp(-(((freq - FORMANT_HZ) / 500) ** 2));
            sum += amplitude * Math.sin((2 * Math.PI * freq * index) / SAMPLE_RATE);
        }
        table[index] = sum * 0.25;
    }
    return table;
})();

function vowelSample(sampleIndex: number): number {
    return VOWEL_TABLE[sampleIndex % VOWEL_PERIOD] ?? 0;
}

function render({
    stepAtBlock,
    retuneSpeedMs,
    formantPreserve,
    blocks,
    heldShift = 0,
}: KneadRenderInput): Float32Array {
    const knead = new KneadInstance(SAMPLE_RATE);
    try {
        knead.set_retune_speed_ms(retuneSpeedMs);
        knead.set_formant_preserve(formantPreserve);
        if (stepAtBlock === null) {
            knead.set_shift_semitones(heldShift);
        }

        const inputLeftPtr = knead.get_input_left_ptr();
        const inputRightPtr = knead.get_input_right_ptr();
        const rendered = new Float32Array(FRAMES * blocks);
        let sampleIndex = 0;

        for (let block = 0; block < blocks; block++) {
            if (stepAtBlock !== null && block === stepAtBlock) {
                knead.set_shift_semitones(SHIFT_SEMITONES);
            }
            // Re-viewed each block: a wasm `memory.grow()` detaches the buffer.
            const inputLeft = new Float32Array(wasm.memory.buffer, inputLeftPtr, FRAMES);
            const inputRight = new Float32Array(wasm.memory.buffer, inputRightPtr, FRAMES);
            for (let frame = 0; frame < FRAMES; frame++) {
                const sample = vowelSample(sampleIndex);
                inputLeft[frame] = sample;
                inputRight[frame] = sample;
                sampleIndex++;
            }
            const outputPtr = knead.process(FRAMES);
            rendered.set(new Float32Array(wasm.memory.buffer, outputPtr, FRAMES), block * FRAMES);
        }

        return rendered;
    } finally {
        knead.free();
    }
}

/**
 * Dominant epoch rate over a slice, via autocorrelation: the smallest lag whose
 * peak reaches 60 % of the global maximum. PSOLA leaves residual source-rate
 * correlation alongside the new epoch rate, so a plain global-max estimate
 * flips between the two; the smallest strong peak is the perceived pitch.
 */
function estimateHz(samples: Float32Array): number {
    const low = Math.floor(SAMPLE_RATE / 1_000);
    const high = Math.floor(SAMPLE_RATE / 60);
    const correlation = new Float64Array(high + 1);
    for (let lag = low; lag <= high; lag++) {
        let acc = 0;
        for (let index = 0; index < samples.length - lag; index++) {
            acc += (samples[index] ?? 0) * (samples[index + lag] ?? 0);
        }
        correlation[lag] = acc;
    }
    let best = 0;
    for (let lag = low; lag <= high; lag++) {
        best = Math.max(best, correlation[lag] ?? 0);
    }
    for (let lag = low; lag <= high; lag++) {
        if ((correlation[lag] ?? 0) >= 0.6 * best) {
            return SAMPLE_RATE / lag;
        }
    }
    return 0;
}

/**
 * Magnitude-weighted mean frequency over a Hann-windowed DFT of `size` samples,
 * restricted to the band the synthetic vowel occupies.
 *
 * The band limit is not cosmetic. A real-time overlap-add render carries
 * broadband grain- and frame-boundary energy far above the vowel, and it is
 * near-identical in both renders; letting it into the mean adds the same large
 * constant to both centroids and drags their *ratio* toward 1, which is the
 * quantity the formant claim is made of. 100 Hz to 4 kHz covers the source
 * envelope (Gaussian, centre 1.2 kHz, σ 500 Hz) and its shifted image with
 * room either side.
 */
const CENTROID_LOW_HZ = 100;
const CENTROID_HIGH_HZ = 4_000;

function spectralCentroid(samples: Float32Array, start: number, size: number): number {
    let numerator = 0;
    let denominator = 0;
    const lowBin = Math.ceil((CENTROID_LOW_HZ * size) / SAMPLE_RATE);
    const highBin = Math.min(Math.floor((CENTROID_HIGH_HZ * size) / SAMPLE_RATE), size / 2 - 1);
    for (let bin = lowBin; bin <= highBin; bin++) {
        let real = 0;
        let imaginary = 0;
        for (let index = 0; index < size; index++) {
            const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
            const value = (samples[start + index] ?? 0) * window;
            const phase = (-2 * Math.PI * bin * index) / size;
            real += value * Math.cos(phase);
            imaginary += value * Math.sin(phase);
        }
        const magnitude = Math.hypot(real, imaginary);
        numerator += magnitude * ((bin * SAMPLE_RATE) / size);
        denominator += magnitude;
    }
    return numerator / Math.max(denominator, 1e-12);
}

function rmsDifference(left: Float32Array, right: Float32Array, start: number, length: number): number {
    let acc = 0;
    for (let index = start; index < start + length; index++) {
        const delta = (left[index] ?? 0) - (right[index] ?? 0);
        acc += delta * delta;
    }
    return Math.sqrt(acc / length);
}

function rms(samples: Float32Array, start: number, length: number): number {
    let acc = 0;
    for (let index = start; index < start + length; index++) {
        acc += (samples[index] ?? 0) ** 2;
    }
    return Math.sqrt(acc / length);
}

describe('checked-in Knead WASM — formantPreserve', () => {
    /**
     * The whole point of the toggle: at the *same* shift, the spectral envelope
     * either stays where the singer put it or scales with the pitch. Measured
     * against each other rather than against the input, so the harmonic comb's
     * own re-sampling of the envelope cancels out of the claim.
     */
    it(
        'moves the spectral envelope by the pitch ratio when preservation is off',
        () => {
            const blocks = 900;
            const preserved = render({
                stepAtBlock: null,
                heldShift: SHIFT_SEMITONES,
                retuneSpeedMs: 0,
                formantPreserve: true,
                blocks,
            });
            const tracked = render({
                stepAtBlock: null,
                heldShift: SHIFT_SEMITONES,
                retuneSpeedMs: 0,
                formantPreserve: false,
                blocks,
            });

            const analysisStart = 8_192;
            const size = 8_192;
            const centroidPreserved = spectralCentroid(preserved, analysisStart, size);
            const centroidTracked = spectralCentroid(tracked, analysisStart, size);

            const scale = centroidTracked / centroidPreserved;
            const detail = `${centroidPreserved.toFixed(0)} Hz -> ${centroidTracked.toFixed(0)} Hz (${scale.toFixed(3)}x, pitch ratio ${SHIFT_RATIO.toFixed(3)})`;
            expect(scale, detail).toBeGreaterThan(SHIFT_RATIO - 0.2);
            expect(scale, detail).toBeLessThan(SHIFT_RATIO + 0.2);
        },
        RENDER_TIMEOUT_MS
    );

    /**
     * Turning the envelope loose must not cost level — the grain window is
     * still applied in output coordinates at hop P_t, so overlap-add still sums
     * to ~1. A grain loop that windowed in *source* coordinates would satisfy
     * the centroid claim above and fail this one.
     */
    it(
        'holds output level when preservation is off',
        () => {
            const blocks = 900;
            const preserved = render({
                stepAtBlock: null,
                heldShift: SHIFT_SEMITONES,
                retuneSpeedMs: 0,
                formantPreserve: true,
                blocks,
            });
            const tracked = render({
                stepAtBlock: null,
                heldShift: SHIFT_SEMITONES,
                retuneSpeedMs: 0,
                formantPreserve: false,
                blocks,
            });

            const start = 8_192;
            const length = 32_768;
            const decibels = 20 * Math.log10(rms(tracked, start, length) / rms(preserved, start, length));
            expect(Math.abs(decibels)).toBeLessThan(2);
        },
        RENDER_TIMEOUT_MS
    );

    /**
     * The toggle is inert at zero shift, and that is correct rather than a
     * hole: with no pitch ratio there is nothing for the envelope to track, and
     * the engine is a bit-exact passthrough. Pinned so a future "always
     * resample the grain" change cannot silently colour an unedited clip.
     */
    it(
        'is a no-op at zero shift, where there is no ratio to track',
        () => {
            const blocks = 400;
            const preserved = render({
                stepAtBlock: null,
                heldShift: 0,
                retuneSpeedMs: 0,
                formantPreserve: true,
                blocks,
            });
            const tracked = render({
                stepAtBlock: null,
                heldShift: 0,
                retuneSpeedMs: 0,
                formantPreserve: false,
                blocks,
            });
            expect(rmsDifference(preserved, tracked, 4_096, 32_768)).toBe(0);
        },
        RENDER_TIMEOUT_MS
    );
});

describe('checked-in Knead WASM — retuneSpeedMs', () => {
    const STEP_BLOCK = 200;
    const BLOCKS = 900;
    /** Where the shift step lands in the *output*, past the 2047-sample group delay. */
    const STEP_SAMPLE = STEP_BLOCK * FRAMES + ANALYSIS_FRAME;

    /**
     * The interior point. Three analysis frames after the step (~128 ms) a slow
     * retune is part-way there and a snap has already arrived. Ends alone
     * cannot separate these: both configurations start at the source pitch and
     * both finish at the target.
     */
    it(
        'renders an intermediate pitch mid-glide that a snap never passes through',
        () => {
            const snapped = render({
                stepAtBlock: STEP_BLOCK,
                retuneSpeedMs: 0,
                formantPreserve: true,
                blocks: BLOCKS,
            });
            const glided = render({
                stepAtBlock: STEP_BLOCK,
                retuneSpeedMs: 200,
                formantPreserve: true,
                blocks: BLOCKS,
            });

            const window = 3 * ANALYSIS_FRAME;
            const slice = (rendered: Float32Array): Float32Array =>
                rendered.slice(STEP_SAMPLE + window, STEP_SAMPLE + window + 3_072);

            const snappedHz = estimateHz(slice(snapped));
            const glidedHz = estimateHz(slice(glided));
            const targetHz = SOURCE_HZ * SHIFT_RATIO;

            // The snap is at the target by then.
            expect(Math.abs(snappedHz - targetHz) / targetHz).toBeLessThan(0.06);
            // The glide is strictly between the source and the target — not at
            // either end, which is what makes this an interior measurement.
            expect(glidedHz).toBeGreaterThan(SOURCE_HZ * 1.03);
            expect(glidedHz).toBeLessThan(targetHz * 0.94);
        },
        RENDER_TIMEOUT_MS
    );

    /**
     * The *shipped default* is 25 ms, not 0 — a guard that only ever drove the
     * control to its extremes would leave the configuration every user
     * actually gets untested. At 25 ms the first analysis frame lands ~84 % of
     * the way, so the default still renders a different transition from a snap.
     */
    it(
        'renders the shipped 25 ms default unlike an instant snap',
        () => {
            const snapped = render({
                stepAtBlock: STEP_BLOCK,
                retuneSpeedMs: 0,
                formantPreserve: true,
                blocks: BLOCKS,
            });
            const defaulted = render({
                stepAtBlock: STEP_BLOCK,
                retuneSpeedMs: 25,
                formantPreserve: true,
                blocks: BLOCKS,
            });

            const transition = rmsDifference(snapped, defaulted, STEP_SAMPLE, 2 * ANALYSIS_FRAME);
            const level = rms(snapped, STEP_SAMPLE, 2 * ANALYSIS_FRAME);
            expect(transition / level).toBeGreaterThan(0.05);
        },
        RENDER_TIMEOUT_MS
    );

    /**
     * Monotonic in the control, checked across the declared 0..200 ms range.
     * A hard switch at some threshold, or a reshaped taper, would satisfy a
     * two-point extremes test and fail this one.
     */
    it(
        'reaches the target later the slower the retune, across the whole range',
        () => {
            const window = 2 * ANALYSIS_FRAME;
            const measured = [0, 50, 100, 200].map((retuneSpeedMs) => {
                const rendered = render({
                    stepAtBlock: STEP_BLOCK,
                    retuneSpeedMs,
                    formantPreserve: true,
                    blocks: BLOCKS,
                });
                return estimateHz(rendered.slice(STEP_SAMPLE + window, STEP_SAMPLE + window + 3_072));
            });

            for (let index = 1; index < measured.length; index++) {
                const slower = measured[index] ?? 0;
                const faster = measured[index - 1] ?? 0;
                expect(slower).toBeLessThan(faster);
            }
        },
        RENDER_TIMEOUT_MS
    );

    /**
     * The glide has to survive the target returning to zero — the analysis gate
     * used to key on the target alone, which would cut a descent off at the
     * blob boundary and reinstate exactly the step the control removes.
     */
    it(
        'keeps rendering a shifted pitch after the target has already returned to zero',
        () => {
            const blocks = 1_400;
            const knead = new KneadInstance(SAMPLE_RATE);
            try {
                knead.set_retune_speed_ms(200);
                knead.set_formant_preserve(true);
                const inputLeftPtr = knead.get_input_left_ptr();
                const inputRightPtr = knead.get_input_right_ptr();
                const rendered = new Float32Array(FRAMES * blocks);
                let sampleIndex = 0;
                for (let block = 0; block < blocks; block++) {
                    if (block === 200) {
                        knead.set_shift_semitones(SHIFT_SEMITONES);
                    }
                    if (block === 700) {
                        knead.set_shift_semitones(0);
                    }
                    const inputLeft = new Float32Array(wasm.memory.buffer, inputLeftPtr, FRAMES);
                    const inputRight = new Float32Array(wasm.memory.buffer, inputRightPtr, FRAMES);
                    for (let frame = 0; frame < FRAMES; frame++) {
                        const sample = vowelSample(sampleIndex);
                        inputLeft[frame] = sample;
                        inputRight[frame] = sample;
                        sampleIndex++;
                    }
                    const outputPtr = knead.process(FRAMES);
                    rendered.set(new Float32Array(wasm.memory.buffer, outputPtr, FRAMES), block * FRAMES);
                }

                const releaseSample = 700 * FRAMES + ANALYSIS_FRAME;
                const duringDescent = estimateHz(
                    rendered.slice(releaseSample + 2 * ANALYSIS_FRAME, releaseSample + 2 * ANALYSIS_FRAME + 3_072)
                );
                const afterSettling = estimateHz(
                    rendered.slice(releaseSample + 40 * ANALYSIS_FRAME, releaseSample + 40 * ANALYSIS_FRAME + 3_072)
                );

                expect(duringDescent).toBeGreaterThan(SOURCE_HZ * 1.05);
                expect(Math.abs(afterSettling - SOURCE_HZ) / SOURCE_HZ).toBeLessThan(0.05);
            } finally {
                knead.free();
            }
        },
        RENDER_TIMEOUT_MS
    );
});
