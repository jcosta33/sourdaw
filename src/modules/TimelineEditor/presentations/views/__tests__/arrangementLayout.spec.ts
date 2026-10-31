import { describe, expect, it, vi } from 'vitest';

import { getArrangementChromeHeight, getArrangementMinimumHeight } from '../arrangementLayout';

vi.mock('#/modules/Arrangement/presentations/views', () => ({
    ARRANGEMENT_BAR_HEIGHT: 22,
    BEAT_RULER_HEIGHT: 18,
    MARKER_LANE_HEIGHT: 20,
    TIMELINE_HORIZONTAL_SCROLLBAR_HEIGHT: 10,
    getAdjustmentLayerStripHeight: (layerCount: number) => (layerCount > 0 ? 28 + layerCount * 18 : 0),
}));

vi.mock('../Timeline/ChordTrackLane', () => ({
    CHORD_TRACK_LANE_HEIGHT: 26,
}));

const bareChrome = { adjustmentLayerCount: 0, hasMarkers: false, minimapHeight: 0, hasChords: false };

describe('getArrangementChromeHeight', () => {
    it('is the arrangement bar plus the beat ruler when nothing optional is shown', () => {
        expect(getArrangementChromeHeight(bareChrome)).toBe(22 + 18);
    });

    it.each([
        ['adjustment layers', { adjustmentLayerCount: 2 }, 28 + 2 * 18],
        ['the marker lane', { hasMarkers: true }, 20],
        ['the minimap', { minimapHeight: 48 }, 48],
        ['the chord lane', { hasChords: true }, 26],
    ])('adds the height of %s', (_name, change, added) => {
        expect(getArrangementChromeHeight({ ...bareChrome, ...change })).toBe(22 + 18 + added);
    });
});

describe('getArrangementMinimumHeight', () => {
    it('is the chrome, one track row and the horizontal scrollbar strip', () => {
        expect(getArrangementMinimumHeight({ ...bareChrome, surfaceMinimumHeight: 64, scratchPadHeight: 0 })).toBe(
            22 + 18 + 64 + 10
        );
    });

    it('adds an open scratch pad', () => {
        expect(getArrangementMinimumHeight({ ...bareChrome, surfaceMinimumHeight: 64, scratchPadHeight: 150 })).toBe(
            22 + 18 + 64 + 10 + 150
        );
    });

    it('sums every optional strip with the row, the scrollbar and the pad', () => {
        expect(
            getArrangementMinimumHeight({
                adjustmentLayerCount: 1,
                hasMarkers: true,
                minimapHeight: 28,
                hasChords: true,
                surfaceMinimumHeight: 26,
                scratchPadHeight: 100,
            })
        ).toBe(22 + 46 + 20 + 28 + 18 + 26 + 26 + 10 + 100);
    });
});
