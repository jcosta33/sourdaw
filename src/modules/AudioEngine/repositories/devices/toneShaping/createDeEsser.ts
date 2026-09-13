import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineDeviceNode } from '../types';

// ── De-esser ─────────────────────────────────────────────────────────────

/** Band width shared by the detector bandpass and its cancellation tap. */
export const DEESSER_BAND_Q = 2;
/** Descriptor defaults for `deess-freq` and `deess-range`. */
export const DEFAULT_DEESSER_FREQUENCY_HZ = 6000;
export const DEFAULT_DEESSER_RANGE_DB = -12;

/**
 * Corner frequency of the envelope smoother, in hertz. It stands in for the
 * attack/release pair of the dynamics compressor this sidechain replaced
 * (1 ms / 50 ms): fast enough to catch a sibilant burst within a few
 * milliseconds, slow enough that the rectified band's 2·f₀ ripple is smoothed
 * to nothing (a 2nd-order lowpass here is ~75 dB down at the ripple).
 */
export const DEESSER_ENVELOPE_HZ = 160;
/** Butterworth Q — maximally flat, so the envelope never overshoots. */
export const DEESSER_ENVELOPE_Q = Math.SQRT1_2;
/**
 * Reduction per unit of linear overshoot past the threshold. The previous
 * graph carried the platform compressor's ratio of 8; in the linear domain
 * that slope is `1 − 1/8`, and the constant is kept so the reduction law
 * does not move with this rewrite.
 */
export const DEESSER_REDUCTION_SLOPE = 1 - 1 / 8;

/**
 * Resolution of the two static control curves. WaveShaper interpolates
 * linearly; the count is odd so x = 0 is a curve sample, keeping the
 * below-threshold branch exactly zero rather than interpolated.
 */
const CURVE_POINTS = 4095;

/**
 * Split-band de-esser (issue #3735). One bandpass feeds three taps:
 *
 *  - the band's series control gain, whose AudioParam (intrinsic 1) is driven
 *    down audio-rate by the reduction control, followed by the wet gain
 *    carrying the range weight `w` — so the band reaches the output
 *    attenuated by at most `−range` dB;
 *  - a cancellation gain at `−w`, removing the raw band from the output;
 *  - a listen gain, which isolates the detector band for auditioning.
 *
 * The reduction control is a standard-node sidechain — rectifier, envelope
 * smoother, overshoot curve — driving the control gain's AudioParam, and its
 * law is built so the device is unity whenever the band sits below threshold:
 *
 *     band gain = (1 − slope · max(0, envelope − threshold)) · w
 *
 * With the envelope below threshold the curve outputs exactly zero and the
 * wet and cancel taps carry the same samples at mirrored weights, cancelling
 * to bit-exact zero; the dry path is untouched unity. Above threshold the
 * control floors at `1 − slope`, so the added attenuation never exceeds `w`
 * — range is the declared reduction **limit**, not a ratio.
 *
 * The graph deliberately contains no DynamicsCompressorNode. Measured on
 * Chromium (the only render target), that node delays everything through it
 * by a fixed 6 ms look-ahead *and* applies a fixed, threshold-dependent
 * makeup gain — `(1/Saturate(1,k))^0.6` in Blink's `dynamics_compressor.cc`
 * — even to signals far below threshold. Both properties are platform
 * behavior, not spec: a split-band cancellation summed against the
 * compressor's output can neither time-align nor level-match, which is the
 * idle comb error this file's previous topology shipped. The sidechain nodes
 * (WaveShaper, BiquadFilter, GainNode, ConstantSourceNode) are all defined
 * by the Web Audio spec formulas, so the law above renders identically
 * everywhere and the taps stay sample-aligned with no compensation delay.
 */
export function createDeEsser(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const inputGain = ctx.createGain();
    inputGain.gain.value = 1;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = DEFAULT_DEESSER_FREQUENCY_HZ;
    bandpass.Q.value = DEESSER_BAND_Q;
    const defaultWeight = dbToGain(DEFAULT_DEESSER_RANGE_DB);
    // The band's series gain element: intrinsic 1, driven down by the
    // reduction curve. An AudioParam sums its intrinsic value with its
    // connected inputs, which is exactly the `1 − reduction` law wanted here;
    // the Range weight stays a separate, unmodulated stage after it.
    const controlGain = ctx.createGain();
    controlGain.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = defaultWeight;
    const cancel = ctx.createGain();
    cancel.gain.value = -defaultWeight;
    const listen = ctx.createGain();
    listen.gain.value = 0;
    const output = ctx.createGain();

    // Control sidechain: |band| → smoothed envelope → (envelope − threshold)
    // → reduction curve → the control gain's AudioParam. `threshLin` carries
    // −10^(threshold/20) so the sum is the linear overshoot past threshold;
    // binding it is how `deess-threshold` automation reaches the law.
    const absShaper = ctx.createWaveShaper();
    absShaper.curve = makeAbsCurve();
    const envFilter = ctx.createBiquadFilter();
    envFilter.type = 'lowpass';
    envFilter.frequency.value = DEESSER_ENVELOPE_HZ;
    envFilter.Q.value = DEESSER_ENVELOPE_Q;
    const threshLin = ctx.createConstantSource();
    threshLin.offset.value = -dbToGain(-20);
    const envSum = ctx.createGain();
    envSum.gain.value = 1;
    const kneeShaper = ctx.createWaveShaper();
    kneeShaper.curve = makeReductionCurve();

    input.connect(inputGain);
    inputGain.connect(output);
    input.connect(bandpass);
    bandpass.connect(controlGain);
    controlGain.connect(wet);
    wet.connect(output);
    bandpass.connect(cancel);
    cancel.connect(output);
    bandpass.connect(listen);
    listen.connect(output);
    bandpass.connect(absShaper);
    absShaper.connect(envFilter);
    envFilter.connect(envSum);
    threshLin.connect(envSum);
    envSum.connect(kneeShaper);
    kneeShaper.connect(controlGain.gain);
    threshLin.start();
    return {
        inputNode: input,
        outputNode: output,
        nodes: [
            input,
            bandpass,
            controlGain,
            wet,
            cancel,
            listen,
            inputGain,
            output,
            absShaper,
            envFilter,
            threshLin,
            envSum,
            kneeShaper,
        ],
        namedNodes: {
            input,
            bandpass,
            controlGain,
            wet,
            cancel,
            listen,
            inputGain,
            output,
            absShaper,
            envFilter,
            threshLin,
            envSum,
            kneeShaper,
        },
    };
}

/** The rectifier: `[-1, 1]` onto `|x|`, so the envelope is the band's level. */
function makeAbsCurve(): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4));
    for (let index = 0; index < CURVE_POINTS; index++) {
        const x = (2 * index) / (CURVE_POINTS - 1) - 1;
        curve[index] = Math.abs(x);
    }
    return curve;
}

/**
 * The reduction carrier: linear overshoot past the threshold onto the
 * *negative* per-unit reduction. It outputs exactly zero for every input at
 * or below zero — the sample-exact unity branch — and floors the control at
 * `1 − DEESSER_REDUCTION_SLOPE` because the envelope itself cannot exceed 1.
 */
function makeReductionCurve(): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4));
    for (let index = 0; index < CURVE_POINTS; index++) {
        const x = (2 * index) / (CURVE_POINTS - 1) - 1;
        curve[index] = x > 0 ? -DEESSER_REDUCTION_SLOPE * x : 0;
    }
    return curve;
}
