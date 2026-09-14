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
 * Linear overshoot of the smoothed envelope past the threshold at which the
 * full Range is engaged. The previous ratio-shaped law reduced `7/8` per unit
 * of overshoot and floored its control at `1 − 7/8`, but the envelope itself
 * cannot pass 1, so the floor sat beyond reach: a declared 12 dB rendered
 * about 2 dB and a declared 30 dB about 0.2 dB (#4263). A saturating knee
 * keeps the declared limit reachable; 0.15 puts full depth at envelope 0.25
 * on the default −20 dB threshold — a −8 dBFS sine peak, well inside sibilant
 * levels but clear of ordinary singing.
 */
export const DEESSER_ENGAGEMENT_OVERSHOOT = 0.15;

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
 *    carrying the reduction weight `1 − w` — so a fully engaged band reaches
 *    the output attenuated by exactly `−range` dB;
 *  - a cancellation gain at `−(1 − w)`, removing the raw band from the output;
 *  - a listen gain, which isolates the detector band for auditioning.
 *
 * The reduction control is a standard-node sidechain — rectifier, envelope
 * smoother, overshoot curve — driving the control gain's AudioParam, and its
 * law is built so the device is unity whenever the band sits below threshold:
 *
 *     band gain = 1 − (1 − w) · min(overshoot / K, 1),  w = 10^(range/20)
 *
 * With the envelope below threshold the curve outputs exactly zero and the
 * wet and cancel taps carry the same samples at mirrored weights, cancelling
 * to bit-exact zero; the dry path is untouched unity. The engagement term
 * saturates at one, so a fully engaged band lands on exactly `w` and no
 * setting attenuates by more than the declared Range — at range 0 the taps
 * weigh nothing and the device is transparent at any level. Range is the
 * declared reduction **limit**, not a ratio.
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
    // The band taps carry the reduction weight `1 − w`, not `w` itself: the
    // engaged band must land on gain `w` (the declared Range), and the output
    // subtracts the taps' weight from unity, so `1 − (1 − w) = w`. With
    // `w = 10^(range/20)` a tap weight of `w` rendered `1 − w·engagement` —
    // over-reducing shallow ranges and barely touching deep ones (#4263).
    const defaultReductionWeight = 1 - dbToGain(DEFAULT_DEESSER_RANGE_DB);
    // The band's series gain element: intrinsic 1, driven down by the
    // reduction curve. An AudioParam sums its intrinsic value with its
    // connected inputs, which is exactly the `1 − reduction` law wanted here;
    // the Range weight stays a separate, unmodulated stage after it.
    const controlGain = ctx.createGain();
    controlGain.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = defaultReductionWeight;
    const cancel = ctx.createGain();
    cancel.gain.value = -defaultReductionWeight;
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
 * *negative* engagement. It outputs exactly zero for every input at or below
 * zero — the sample-exact unity branch — and saturates at −1 once the
 * overshoot reaches `DEESSER_ENGAGEMENT_OVERSHOOT`, flooring the control at
 * zero: full Range, exactly the declared reduction.
 */
function makeReductionCurve(): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4));
    for (let index = 0; index < CURVE_POINTS; index++) {
        const x = (2 * index) / (CURVE_POINTS - 1) - 1;
        curve[index] = x > 0 ? -Math.min(x / DEESSER_ENGAGEMENT_OVERSHOOT, 1) : 0;
    }
    return curve;
}
