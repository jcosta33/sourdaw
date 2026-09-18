import { type GainEnvelopePoint, sampleGainEnvelopeSeries } from '../../stores/gainEnvelopeStore';

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
 *
 * The walk itself lives in the store (`sampleGainEnvelopeSeries`), stated once
 * for the one-beat read and for the span series both audio renderers schedule;
 * this is the one-beat read over a zero-width span of that one law.
 */
export function sampleGainEnvelopePoints(points: readonly GainEnvelopePoint[], beatOffset: number): number {
    if (points.length === 0) {
        return 0;
    }

    const series = sampleGainEnvelopeSeries(points, beatOffset, beatOffset);
    return series[series.length - 1]!.gainDb;
}
