import { describe, expect, it } from 'vitest';

import {
    getRenderedTrackExtent,
    getRenderedTrackTops,
    getVariationLaneCount,
    showsVariationLanes,
    getVariationLaneExtent,
    VARIATION_LANE_HEIGHT,
} from '../TimelineTrackExtent';
import { createTrack, type Track } from '../Track';

function makeTrack(kind: Track['kind'], overrides: Partial<Track> = {}, alternativeCount = 3): Track {
    const base = createTrack({
        id: kind,
        kind,
        name: kind,
        initialDeviceId: `${kind}-device`,
        initialAlternativeId: `${kind}-alt-0`,
    });
    return {
        ...base,
        alternatives: Array.from({ length: alternativeCount }, (_, index) => ({
            id: `${kind}-alt-${index}`,
            name: `Alternative ${index + 1}`,
            clips: [],
        })),
        ...overrides,
    };
}

describe('getVariationLaneCount and getVariationLaneExtent', () => {
    it.each(['audio', 'midi', 'bus'] as const)(
        'gives a %s track one lane per alternative while the toggle is on',
        (kind) => {
            const track = makeTrack(kind, { showVariationLanes: true });

            expect(getVariationLaneCount(track)).toBe(3);
            expect(getVariationLaneExtent(track)).toBe(3 * VARIATION_LANE_HEIGHT);
        }
    );

    it.each(['audio', 'midi', 'bus'] as const)('gives a %s track no lanes while the toggle is off or unset', (kind) => {
        expect(getVariationLaneExtent(makeTrack(kind, { showVariationLanes: false }))).toBe(0);
        expect(getVariationLaneExtent(makeTrack(kind))).toBe(0);
    });

    it.each(['folder', 'master'] as const)('never gives a %s row lanes, even with the toggle on', (kind) => {
        const track = makeTrack(kind, { showVariationLanes: true });

        expect(getVariationLaneCount(track)).toBe(0);
        expect(getVariationLaneExtent(track)).toBe(0);
    });

    it('scales with the alternative count', () => {
        expect(getVariationLaneExtent(makeTrack('audio', { showVariationLanes: true }, 1))).toBe(24);
        expect(getVariationLaneExtent(makeTrack('audio', { showVariationLanes: true }, 5))).toBe(120);
    });
});

describe('showsVariationLanes', () => {
    it.each(['audio', 'midi', 'bus'] as const)(
        'is true for a %s track with the toggle on, whatever its alternatives',
        (kind) => {
            expect(showsVariationLanes(makeTrack(kind, { showVariationLanes: true }))).toBe(true);
            expect(showsVariationLanes(makeTrack(kind, { showVariationLanes: true }, 0))).toBe(true);
        }
    );

    it('is false with the toggle off or unset', () => {
        expect(showsVariationLanes(makeTrack('audio', { showVariationLanes: false }))).toBe(false);
        expect(showsVariationLanes(makeTrack('audio'))).toBe(false);
    });

    it.each(['folder', 'master'] as const)('is false for a %s row even with the toggle on', (kind) => {
        expect(showsVariationLanes(makeTrack(kind, { showVariationLanes: true }))).toBe(false);
    });

    it('leaves a toggled-on track with no alternatives with zero lane rows', () => {
        const track = makeTrack('midi', { showVariationLanes: true }, 0);

        expect(showsVariationLanes(track)).toBe(true);
        expect(getVariationLaneCount(track)).toBe(0);
        expect(getVariationLaneExtent(track)).toBe(0);
    });
});

describe('getRenderedTrackExtent and getRenderedTrackTops', () => {
    it('adds the lane block to the row height', () => {
        expect(getRenderedTrackExtent({ height: 64 })).toBe(64);
        expect(getRenderedTrackExtent({ height: 64, variationLanes: [{}, {}] })).toBe(64 + 2 * VARIATION_LANE_HEIGHT);
    });

    it('stacks each track below the previous one extent', () => {
        const tracks = [{ height: 64, variationLanes: [{}, {}] }, { height: 40 }, { height: 26 }];

        expect(getRenderedTrackTops(tracks)).toEqual([0, 112, 152]);
    });
});
