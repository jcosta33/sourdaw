import { type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';

/**
 * The clip gain envelope curve law on raw points, without the store read or the
 * enabled gate: constant at the edge values outside the point range, linear in
 * dB between adjacent points. `getGainAtBeat` is this over the stored,
 * enabled-gated envelope; the split repartition samples the same curve to place
 * its seam points, so a cut can never change what the envelope sounded like.
 *
 * Coincident points (a zero-width span) resolve to the later point's value
 * rather than dividing by zero.
 */
export function sampleGainEnvelopePoints(points: readonly GainEnvelopePoint[], beatOffset: number): number {
    if (points.length === 0) {
        return 0;
    }

    if (beatOffset <= points[0]!.beatOffset) {
        return points[0]!.gainDb;
    }

    const lastPoint = points[points.length - 1]!;
    if (beatOffset >= lastPoint.beatOffset) {
        return lastPoint.gainDb;
    }

    for (let index = 0; index < points.length - 1; index++) {
        const alpha = points[index]!;
        const beta = points[index + 1]!;
        if (beatOffset >= alpha.beatOffset && beatOffset <= beta.beatOffset) {
            const span = beta.beatOffset - alpha.beatOffset;
            if (span === 0) {
                return beta.gainDb;
            }
            const time = (beatOffset - alpha.beatOffset) / span;
            return alpha.gainDb + time * (beta.gainDb - alpha.gainDb);
        }
    }

    return 0;
}
