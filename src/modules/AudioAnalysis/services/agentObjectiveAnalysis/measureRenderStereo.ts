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
};

export type MeasureRenderStereoInput = {
    readonly left: Float32Array;
    readonly right: Float32Array;
    readonly length: number;
};

export function measureRenderStereo({ left, right, length }: MeasureRenderStereoInput): RenderStereoReadings {
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
    };
}
