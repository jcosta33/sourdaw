type Stereo = { left: Float64Array; right: Float64Array };

export type LawCompressorSettings = {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    attackMs: number;
    releaseMs: number;
    makeupDb: number;
};

/** Blink's static curve for one setting: linear to the threshold, an exponential knee, then the ratio. */
type StaticCurve = {
    linearThreshold: number;
    kneeThreshold: number;
    kneeThresholdDb: number;
    kneeThresholdOutputDb: number;
    k: number;
    slope: number;
};

/**
 * `DynamicsCompressorNode` reads its detector this far ahead of the audio it scales
 * (`DYNAMICS_COMPRESSOR_LOOKAHEAD_MS`, measured as a 288-frame delay at 48 kHz in Chromium), and plugin
 * delay compensation lines its output up with the timeline again, so the law reads the peak this far
 * ahead and writes the gain in place.
 */
const LOOKAHEAD_SECONDS = 0.006;

/**
 * The node's detector takes each new reduction at once and lets it go over 2.5 ms (Blink's
 * saturation release), so a waveform's peaks hold the reduction between them.
 */
const DETECTOR_RELEASE_SECONDS = 0.0025;

/**
 * The node's gain follows its detector with time constants that are these fractions of its attack and
 * release times, fitted to Chromium's step responses on a 10 dB step: the attack closes in linear gain
 * (a 10 ms attack leaves about 2.5% of the step after 10 ms), the release reopens in decibels (a 100 ms
 * release reopens about 17% of what is left every 5 ms at its start).
 */
const ATTACK_TIME_CONSTANT_FRACTION = 1 / 3.7;
const RELEASE_TIME_CONSTANT_FRACTION = 1 / 4;

function decibels(linear: number): number {
    return 20 * Math.log10(Math.max(linear, 1e-9));
}

function linear(decibelValue: number): number {
    return 10 ** (decibelValue / 20);
}

function kneeCurve(x: number, linearThreshold: number, k: number): number {
    if (x < linearThreshold) {
        return x;
    }
    return linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;
}

/** The knee's slope in decibels at `x`, the way Blink approximates it. */
function kneeSlopeAt(x: number, linearThreshold: number, k: number): number {
    if (x < linearThreshold) {
        return 1;
    }
    const further = x * 1.001;
    return (
        (decibels(kneeCurve(further, linearThreshold, k)) - decibels(kneeCurve(x, linearThreshold, k))) /
        (decibels(further) - decibels(x))
    );
}

/** Blink's search for the knee sharpness whose slope meets `1 / ratio` at the knee's top. */
function kneeSharpness(linearThreshold: number, kneeThreshold: number, slope: number): number {
    let minimum = 0.1;
    let maximum = 10_000;
    let k = 5;
    for (let step = 0; step < 15; step++) {
        if (kneeSlopeAt(kneeThreshold, linearThreshold, k) < slope) {
            maximum = k;
        } else {
            minimum = k;
        }
        k = Math.sqrt(minimum * maximum);
    }
    return k;
}

function staticCurve(settings: Pick<LawCompressorSettings, 'thresholdDb' | 'ratio' | 'kneeDb'>): StaticCurve {
    const linearThreshold = linear(settings.thresholdDb);
    const kneeThresholdDb = settings.thresholdDb + settings.kneeDb;
    const kneeThreshold = linear(kneeThresholdDb);
    const slope = 1 / Math.max(1, settings.ratio);
    const k = kneeSharpness(linearThreshold, kneeThreshold, slope);
    return {
        linearThreshold,
        kneeThreshold,
        kneeThresholdDb,
        kneeThresholdOutputDb: decibels(kneeCurve(kneeThreshold, linearThreshold, k)),
        k,
        slope,
    };
}

function saturate(x: number, curve: StaticCurve): number {
    if (x < curve.kneeThreshold) {
        return kneeCurve(x, curve.linearThreshold, curve.k);
    }
    return linear(curve.kneeThresholdOutputDb + curve.slope * (decibels(x) - curve.kneeThresholdDb));
}

/** How far the static curve pulls a peak down, in decibels. */
function gainReductionDb(peak: number, curve: StaticCurve): number {
    if (peak <= curve.linearThreshold) {
        return 0;
    }
    return decibels(peak) - decibels(saturate(peak, curve));
}

/**
 * The Web Audio `DynamicsCompressorNode` as the product renders it (`createCompressor`), then the
 * device's own makeup stage: a stereo-linked peak read 6 ms ahead, Blink's static curve, its gain
 * reduction smoothed in decibels with the attack and release fitted above, and the node's automatic
 * makeup, the inverse of its gain at full scale raised to 0.6 (the Web Audio specification's
 * DynamicsCompressorNode processing).
 *
 * Remaining gap against Chromium: Blink smooths in a warped gain domain with a release rate that varies
 * with the reduction still held, which one-pole smoothing does not follow. On a steady 1 kHz sine at
 * threshold -20 dB, ratio 4 and knee 0, the law's gain is -1.47 dB for a -6 dBFS input where Chromium's
 * is -1.31 dB, and -5.96 dB against -5.79 dB at 0 dBFS. On the law's sources the crest factor parts
 * where the compressor works hardest: vocal-controlled at its midpoints takes source 3 from 7.92 dB to
 * 8.75 dB here and to 7.01 dB in Chromium. Below the threshold Chromium still raises crest: bass-glued
 * takes source 0 from 15.38 dB to 15.56 dB, where the law leaves it at 15.38 dB. No recipe claims crest
 * factor on those points.
 */
export function compress(signal: Stereo, settings: LawCompressorSettings, sampleRate: number): Stereo {
    const curve = staticCurve(settings);
    const lookahead = Math.round(LOOKAHEAD_SECONDS * sampleRate);
    const detectorRelease = onePole(DETECTOR_RELEASE_SECONDS, sampleRate);
    const attack = onePole(settings.attackMs * 0.001 * ATTACK_TIME_CONSTANT_FRACTION, sampleRate);
    const release = onePole(settings.releaseMs * 0.001 * RELEASE_TIME_CONSTANT_FRACTION, sampleRate);
    const makeupDb = settings.makeupDb - 0.6 * decibels(saturate(1, curve));
    const frames = signal.left.length;
    const left = new Float64Array(frames);
    const right = new Float64Array(frames);
    let detectorGain = 1;
    let gain = 1;
    for (let frame = 0; frame < frames; frame++) {
        const ahead = frame + lookahead;
        // Past the window's end there is nothing ahead to read, so the gain holds what it last reached.
        if (ahead < frames) {
            const peak = Math.max(Math.abs(signal.left[ahead]!), Math.abs(signal.right[ahead]!));
            const target = linear(-gainReductionDb(peak, curve));
            detectorGain = target < detectorGain ? target : smooth(detectorGain, target, detectorRelease);
            gain = detectorGain < gain ? smooth(gain, detectorGain, attack) : releaseGain(gain, detectorGain, release);
        }
        const scaled = gain * linear(makeupDb);
        left[frame] = signal.left[frame]! * scaled;
        right[frame] = signal.right[frame]! * scaled;
    }
    return { left, right };
}

function onePole(timeConstantSeconds: number, sampleRate: number): number {
    return Math.exp(-1 / Math.max(timeConstantSeconds * sampleRate, 1));
}

function smooth(current: number, target: number, coefficient: number): number {
    return coefficient * current + (1 - coefficient) * target;
}

/** The release reopens in decibels, the way Blink's release moves a fixed share of decibels per frame. */
function releaseGain(gain: number, target: number, coefficient: number): number {
    return linear(smooth(decibels(gain), decibels(target), coefficient));
}
