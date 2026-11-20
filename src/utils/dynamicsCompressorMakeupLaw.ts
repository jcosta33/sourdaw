/**
 * The makeup gain Chromium's `DynamicsCompressorNode` adds on its own.
 *
 * Blink scales every output sample of the node by a fixed post-gain it derives
 * from the static curve alone: `powf(1 / Saturate(1, k), 0.6f)`, where `k` is the
 * knee curvature that `KAtSlope` searches for so the knee meets the ratio
 * slope at `threshold + knee`. The Web Audio specification names no such gain,
 * and no control on the node removes it. At threshold −20 dB, knee 6 dB and
 * ratio 4 it is about +7.85 dB.
 *
 * This is a port of that law, read from
 * `third_party/blink/renderer/platform/audio/dynamics_compressor.cc`
 * (`Process`, `UpdateStaticCurveParameters`, `KAtSlope`, `KneeCurve`,
 * `Saturate`) and `audio_utilities.cc` (`DecibelsToLinear`,
 * `LinearToDecibels`). Blink computes in single precision, so every step is
 * rounded with `Math.fround` where the C++ stores a `float`; the bisection in
 * `KAtSlope` branches on those rounded slopes, and doing it in double
 * precision can pick a different `k`.
 *
 * The audio path never evaluates this: the built-in compressor cancels the
 * gain by measuring it on a twin node (`applyCompressorAutoMakeup`), so it
 * follows automation on every render quantum. This port is what the panel
 * draws and what the measurement specs predict against.
 */

const f = Math.fround;

/** The nominal ranges Chromium clamps the node's AudioParams to. */
const THRESHOLD_RANGE_DB = { min: -100, max: 0 } as const;
const KNEE_RANGE_DB = { min: 0, max: 40 } as const;
const RATIO_RANGE = { min: 1, max: 20 } as const;

export type DynamicsCompressorStaticCurve = {
    thresholdDb: number;
    kneeDb: number;
    ratio: number;
};

type ResolvedCurve = {
    linearThreshold: number;
    kneeThreshold: number;
    kneeThresholdDb: number;
    yKneeThresholdDb: number;
    slope: number;
    k: number;
};

function clamp(value: number, range: { min: number; max: number }): number {
    return Math.min(range.max, Math.max(range.min, value));
}

function decibelsToLinear(decibels: number): number {
    return f(10 ** f(f(0.05) * decibels));
}

function linearToDecibels(linear: number): number {
    return f(20 * f(Math.log10(linear)));
}

function kneeCurve(x: number, k: number, linearThreshold: number): number {
    if (x < linearThreshold) {
        return x;
    }
    const decay = f(Math.exp(f(-k * f(x - linearThreshold))));
    return f(linearThreshold + f(f(1 - decay) / k));
}

function kneeAtSlope(desiredSlope: number, thresholdDb: number, kneeDb: number, linearThreshold: number): number {
    const dbX = f(thresholdDb + kneeDb);
    const x = decibelsToLinear(dbX);
    const onKnee = !(x < linearThreshold);
    const x2 = onKnee ? f(x * 1.001) : 1;
    const dbX2 = onKnee ? linearToDecibels(x2) : 0;

    let minK = f(0.1);
    let maxK = 10000;
    let k = 5;
    let slope = 1;
    for (let iteration = 0; iteration < 15; iteration++) {
        if (onKnee) {
            const dbY = linearToDecibels(kneeCurve(x, k, linearThreshold));
            const dbY2 = linearToDecibels(kneeCurve(x2, k, linearThreshold));
            slope = f(f(dbY2 - dbY) / f(dbX2 - dbX));
        }
        if (slope < desiredSlope) {
            maxK = k;
        } else {
            minK = k;
        }
        k = f(Math.sqrt(f(minK * maxK)));
    }
    return k;
}

function resolveCurve(curve: DynamicsCompressorStaticCurve): ResolvedCurve {
    const thresholdDb = f(clamp(curve.thresholdDb, THRESHOLD_RANGE_DB));
    const kneeDb = f(clamp(curve.kneeDb, KNEE_RANGE_DB));
    const ratio = f(clamp(curve.ratio, RATIO_RANGE));
    const linearThreshold = decibelsToLinear(thresholdDb);
    const slope = f(1 / ratio);
    const k = kneeAtSlope(slope, thresholdDb, kneeDb, linearThreshold);
    const kneeThresholdDb = f(thresholdDb + kneeDb);
    const kneeThreshold = decibelsToLinear(kneeThresholdDb);
    const yKneeThresholdDb = linearToDecibels(kneeCurve(kneeThreshold, k, linearThreshold));
    return { linearThreshold, kneeThreshold, kneeThresholdDb, yKneeThresholdDb, slope, k };
}

function saturate(x: number, curve: ResolvedCurve): number {
    if (x < curve.kneeThreshold) {
        return kneeCurve(x, curve.k, curve.linearThreshold);
    }
    const dbX = linearToDecibels(x);
    const dbY = f(curve.yKneeThresholdDb + f(curve.slope * f(dbX - curve.kneeThresholdDb)));
    return decibelsToLinear(dbY);
}

/** The linear post-gain Chromium multiplies the node's output by. Never below 1. */
export function dynamicsCompressorHiddenMakeupGain(curve: DynamicsCompressorStaticCurve): number {
    const resolved = resolveCurve(curve);
    return f(f(1 / saturate(1, resolved)) ** f(0.6));
}

/** {@link dynamicsCompressorHiddenMakeupGain} in decibels. */
export function dynamicsCompressorHiddenMakeupDb(curve: DynamicsCompressorStaticCurve): number {
    return 20 * Math.log10(dynamicsCompressorHiddenMakeupGain(curve));
}

/**
 * Static output level, in dBFS, of a steady signal whose detector level is
 * `inputDb`, before Chromium's post-gain: the node's own `Saturate` curve.
 * The envelope follower settles on this for a constant peak level.
 */
export function dynamicsCompressorStaticOutputDb(curve: DynamicsCompressorStaticCurve, inputDb: number): number {
    const resolved = resolveCurve(curve);
    return 20 * Math.log10(saturate(decibelsToLinear(inputDb), resolved));
}

/**
 * Whether a stored Auto Makeup value leaves Chromium's hidden gain in the
 * output. An absent value is on: every compressor written before the switch
 * existed sounded with it. A stored value reads as the nearest setting, the
 * way the parameter law quantises a `bool` on delivery.
 */
export function isCompressorAutoMakeupEngaged(storedValue: number | undefined): boolean {
    return storedValue === undefined || Math.round(storedValue) !== 0;
}
