import { beforeEach, describe, expect, it } from 'vitest';

import { getGainAtBeat } from '../../useCases';
import { sampleGainEnvelopePoints } from '../../useCases/clipGainEnvelope/sampleGainEnvelopePoints';
import {
    __resetGainEnvelopesForTest,
    clipHasActiveGainEnvelope,
    getGainEnvelopeSeries,
    gainEnvelopeStore,
    sampleGainEnvelopeSeries,
    setEnvelope,
    type GainEnvelopePoint,
} from '../gainEnvelopeStore';

function envelopePoint(beatOffset: number, gainDb: number): GainEnvelopePoint {
    return { id: `gep-${beatOffset}-${gainDb}`, beatOffset, gainDb };
}

const CURVE_POINTS: GainEnvelopePoint[] = [envelopePoint(0, -12), envelopePoint(2, -6), envelopePoint(4, 0)];

describe('sampleGainEnvelopeSeries', () => {
    it('samples the span edges and carries every interior point', () => {
        expect(sampleGainEnvelopeSeries(CURVE_POINTS, 0, 4)).toEqual([
            { beatOffset: 0, gainDb: -12 },
            { beatOffset: 2, gainDb: -6 },
            { beatOffset: 4, gainDb: 0 },
        ]);
    });

    it('interpolates the edge values when the span cuts through a segment', () => {
        // Halfway from beat 0 (-12 dB) to beat 2 (-6 dB) is -9 dB.
        expect(sampleGainEnvelopeSeries(CURVE_POINTS, 1, 3)).toEqual([
            { beatOffset: 1, gainDb: -9 },
            { beatOffset: 2, gainDb: -6 },
            { beatOffset: 3, gainDb: -3 },
        ]);
    });

    it('holds the edge point values outside the point range', () => {
        expect(sampleGainEnvelopeSeries(CURVE_POINTS, -2, 1)).toEqual([
            { beatOffset: -2, gainDb: -12 },
            { beatOffset: 0, gainDb: -12 },
            { beatOffset: 1, gainDb: -9 },
        ]);
        expect(sampleGainEnvelopeSeries(CURVE_POINTS, 5, 7)).toEqual([
            { beatOffset: 5, gainDb: 0 },
            { beatOffset: 7, gainDb: 0 },
        ]);
    });

    it('answers one sample for a zero-width span', () => {
        expect(sampleGainEnvelopeSeries(CURVE_POINTS, 1, 1)).toEqual([{ beatOffset: 1, gainDb: -9 }]);
    });
});

describe('the series and the one-beat read state one law', () => {
    it('matches sampleGainEnvelopePoints across and beyond the point range', () => {
        for (let beat = -1; beat <= 5; beat += 0.25) {
            const series = sampleGainEnvelopeSeries(CURVE_POINTS, beat, beat);
            expect(series[series.length - 1]!.gainDb).toBeCloseTo(sampleGainEnvelopePoints(CURVE_POINTS, beat), 9);
        }
    });
});

describe('getGainEnvelopeSeries', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('reads the stored, enabled envelope over the span', () => {
        setEnvelope('clip-1', { clipId: 'clip-1', points: CURVE_POINTS, enabled: true });

        expect(getGainEnvelopeSeries('clip-1', 0, 4)).toEqual([
            { beatOffset: 0, gainDb: -12 },
            { beatOffset: 2, gainDb: -6 },
            { beatOffset: 4, gainDb: 0 },
        ]);
    });

    it('answers undefined for an absent, disabled, or provably flat envelope', () => {
        setEnvelope('clip-flat', {
            clipId: 'clip-flat',
            points: [envelopePoint(0, 0), envelopePoint(4, 0)],
            enabled: true,
        });
        setEnvelope('clip-off', { clipId: 'clip-off', points: CURVE_POINTS, enabled: false });

        expect(getGainEnvelopeSeries('clip-absent', 0, 4)).toBeUndefined();
        expect(getGainEnvelopeSeries('clip-flat', 0, 4)).toBeUndefined();
        expect(getGainEnvelopeSeries('clip-off', 0, 4)).toBeUndefined();
    });

    it('agrees with getGainAtBeat at the span edges', () => {
        setEnvelope('clip-1', { clipId: 'clip-1', points: CURVE_POINTS, enabled: true });

        const series = getGainEnvelopeSeries('clip-1', 1, 3)!;
        expect(series[0]!.gainDb).toBeCloseTo(getGainAtBeat('clip-1', 1), 9);
        expect(series[series.length - 1]!.gainDb).toBeCloseTo(getGainAtBeat('clip-1', 3), 9);
    });
});

describe('clipHasActiveGainEnvelope', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('is true only for an enabled envelope holding a non-zero point', () => {
        expect(clipHasActiveGainEnvelope('clip-absent')).toBe(false);

        setEnvelope('clip-flat', {
            clipId: 'clip-flat',
            points: [envelopePoint(0, 0), envelopePoint(4, 0)],
            enabled: true,
        });
        expect(clipHasActiveGainEnvelope('clip-flat')).toBe(false);

        setEnvelope('clip-off', { clipId: 'clip-off', points: CURVE_POINTS, enabled: false });
        expect(clipHasActiveGainEnvelope('clip-off')).toBe(false);

        setEnvelope('clip-live', { clipId: 'clip-live', points: CURVE_POINTS, enabled: true });
        expect(clipHasActiveGainEnvelope('clip-live')).toBe(true);
    });

    it('does not mutate the store it reads', () => {
        setEnvelope('clip-live', { clipId: 'clip-live', points: CURVE_POINTS, enabled: true });
        clipHasActiveGainEnvelope('clip-live');
        getGainEnvelopeSeries('clip-live', 0, 4);
        expect(gainEnvelopeStore.value?.envelopes['clip-live']?.points).toHaveLength(3);
    });
});
