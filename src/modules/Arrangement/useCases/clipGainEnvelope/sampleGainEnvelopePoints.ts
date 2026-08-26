import { type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';

/**
 * The clip gain envelope curve law on raw points, without the store read or the
 * enabled gate: constant at the edge values outside the point range, linear in
 * dB between adjacent points. `getGainAtBeat` is this over the stored,
 * enabled-gated envelope; the split repartition samples the same curve to place
 * its seam points, so a cut can never change what the envelope sounded like.
 *
 * Two points at one `beatOffset` never make the walk divide a zero-width span:
 * a segment is only ever entered from below its end, so a coincident pair reads
 * as whichever of the two the approach reaches — the earlier one mid-curve, the
 * later one past the end of the curve.
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
            const time = (beatOffset - alpha.beatOffset) / span;
            return alpha.gainDb + time * (beta.gainDb - alpha.gainDb);
        }
    }

    return 0;
}
