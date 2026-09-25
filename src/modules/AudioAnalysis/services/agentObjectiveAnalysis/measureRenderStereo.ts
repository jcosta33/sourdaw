import { applyBiquad } from '#/utils/audioMetering/applyBiquad';
import { type LoudnessBiquad } from '#/utils/audioMetering/createKWeightingFilters';

/**
 * Stereo relationship between the first two channels of a render.
 *
 * Correlation is the phase-correlation meter every DAW shows: the normalised
 * inner product of the two channels without mean removal, +1 for identical
 * channels and -1 for a polarity-inverted pair. The mean is deliberately not
 * removed — a rendered mix with a DC offset should still report the correlation
 * an engineer sees on the meter, and the offset itself is reported as its own
 * metric rather than folded into this one.
 */

export type RenderStereoReadings = {
    readonly correlation: number;
    /** Side energy as a fraction of total mid+side energy: 0 is mono, 1 is fully out of phase. */
    readonly sideEnergyFraction: number;
    /** Side energy as a fraction of total mid+side energy, below `LOW_FREQUENCY_CROSSOVER_HZ`. */
    readonly lowFrequencyStereoContent: number;
};

export type MeasureRenderStereoInput = {
    readonly left: Float32Array;
    readonly right: Float32Array;
    readonly length: number;
    readonly sampleRate: number;
};

/**
 * Bass mixed out of phase loses energy in mono playback and on subs that sum
 * to mono; mastering stereo-width tools default their bass-mono crossover
 * near this point, so it is the conventional place to judge low-end width.
 */
const LOW_FREQUENCY_CROSSOVER_HZ = 120;
/** RBJ Butterworth Q; two cascaded stages at this Q form a 4th-order Linkwitz-Riley crossover. */
const LOW_PASS_Q = Math.SQRT1_2;

/** RBJ Audio EQ Cookbook low-pass biquad, coefficients normalised so a0 = 1. */
function createLowPassBiquad(sampleRate: number, cutoffHz: number): LoudnessBiquad {
    const omega = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(omega) / (2 * LOW_PASS_Q);
    const cosOmega = Math.cos(omega);
    const a0 = 1 + alpha;

    return {
        b0: (1 - cosOmega) / 2 / a0,
        b1: (1 - cosOmega) / a0,
        b2: (1 - cosOmega) / 2 / a0,
        a1: (-2 * cosOmega) / a0,
        a2: (1 - alpha) / a0,
    };
}

/** Two cascaded Butterworth low-pass stages make a 4th-order Linkwitz-Riley crossover. */
function lowPassChannel(channel: Float32Array, length: number, sampleRate: number): Float64Array {
    const filtered = new Float64Array(length);
    for (let index = 0; index < length; index++) {
        filtered[index] = channel[index] ?? 0;
    }

    const filter = createLowPassBiquad(sampleRate, LOW_FREQUENCY_CROSSOVER_HZ);
    applyBiquad(filtered, filter);
    applyBiquad(filtered, filter);
    return filtered;
}

/** Side energy as a fraction of total mid+side energy, formed from the low-passed channels. */
function measureLowFrequencyStereoContent(
    left: Float32Array,
    right: Float32Array,
    length: number,
    sampleRate: number
): number {
    const leftLow = lowPassChannel(left, length, sampleRate);
    const rightLow = lowPassChannel(right, length, sampleRate);

    let midSquares = 0;
    let sideSquares = 0;
    for (let index = 0; index < length; index++) {
        const leftSample = leftLow[index] ?? 0;
        const rightSample = rightLow[index] ?? 0;
        const mid = (leftSample + rightSample) / 2;
        const side = (leftSample - rightSample) / 2;
        midSquares += mid * mid;
        sideSquares += side * side;
    }

    const totalEnergy = midSquares + sideSquares;
    return totalEnergy > 0 ? sideSquares / totalEnergy : 0;
}

export function measureRenderStereo({
    left,
    right,
    length,
    sampleRate,
}: MeasureRenderStereoInput): RenderStereoReadings {
    let leftSquares = 0;
    let rightSquares = 0;
    let product = 0;
    let midSquares = 0;
    let sideSquares = 0;

    for (let index = 0; index < length; index++) {
        const leftSample = left[index] ?? 0;
        const rightSample = right[index] ?? 0;
        leftSquares += leftSample * leftSample;
        rightSquares += rightSample * rightSample;
        product += leftSample * rightSample;
        const mid = (leftSample + rightSample) / 2;
        const side = (leftSample - rightSample) / 2;
        midSquares += mid * mid;
        sideSquares += side * side;
    }

    const normalizer = Math.sqrt(leftSquares * rightSquares);
    const totalEnergy = midSquares + sideSquares;

    return {
        // A silent channel correlates with nothing, which is what a meter reads
        // as zero rather than as an undefined quotient.
        correlation: normalizer > 0 ? product / normalizer : 0,
        sideEnergyFraction: totalEnergy > 0 ? sideSquares / totalEnergy : 0,
        lowFrequencyStereoContent: measureLowFrequencyStereoContent(left, right, length, sampleRate),
    };
}
