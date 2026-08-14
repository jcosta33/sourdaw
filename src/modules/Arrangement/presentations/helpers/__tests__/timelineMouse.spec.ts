import { describe, it, expect, beforeEach, vi } from 'vitest';

import { timelineViewStore } from '../../../stores/timelineViewStore';
import { canvasXToBeat, getContentY, resolveTrackAtY, valueAtTrackY } from '../timelineMouse';

const mocks = vi.hoisted(() => ({
    buildTimelineRenderModel: vi.fn<() => { tracks: { id: string; height: number }[] } | null>(),
    getTrackAtY: vi.fn<(tracks: unknown[], y: number) => { index: number } | null>(),
}));

vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: () => mocks.buildTimelineRenderModel(),
}));

vi.mock('../../../useCases/timelineInteractions/getTrackAtY', () => ({
    getTrackAtY: (tracks: unknown[], y: number) => mocks.getTrackAtY(tracks, y),
}));

describe('getContentY', () => {
    it('should map canvas Y to content Y using scroll and ruler offset', () => {
        expect(getContentY(100, 24)).toBe(124);
    });
});

describe('valueAtTrackY', () => {
    it('should return a normalised 0–1 value within the track height', () => {
        expect(valueAtTrackY(50, 0, 100)).toBeCloseTo(0.5);
    });

    it('should clamp outside the track to 0 or 1', () => {
        expect(valueAtTrackY(-10, 0, 100)).toBe(1);
        expect(valueAtTrackY(200, 0, 100)).toBe(0);
    });
});

describe('resolveTrackAtY', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the track id, height, and cumulative top offset for a hit', () => {
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                { id: 't1', height: 60 },
                { id: 't2', height: 80 },
            ],
        });
        mocks.getTrackAtY.mockReturnValue({ index: 1 });

        const result = resolveTrackAtY(100);

        expect(result).toEqual({ trackId: 't2', height: 80, offset: 60, index: 1 });
    });

    it('returns null when no track covers the Y coordinate', () => {
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [{ id: 't1', height: 60 }] });
        mocks.getTrackAtY.mockReturnValue(null);

        expect(resolveTrackAtY(999)).toBeNull();
    });

    it('returns null when the render model has not loaded', () => {
        mocks.buildTimelineRenderModel.mockReturnValue(null);

        expect(resolveTrackAtY(0)).toBeNull();
    });

    it('falls back to a 64px height when a track omits one', () => {
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1' } as { id: string; height: number }],
        });
        mocks.getTrackAtY.mockReturnValue({ index: 0 });

        expect(resolveTrackAtY(0)).toEqual({ trackId: 't1', height: 64, offset: 0, index: 0 });
    });
});

describe('canvasXToBeat', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 24,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
    });

    it('should convert canvas X using pixels per beat and scroll', () => {
        expect(canvasXToBeat(0)).toBeCloseTo(2);
    });

    it('should return zero when the timeline view store is empty', () => {
        timelineViewStore.set(null);
        expect(canvasXToBeat(99)).toBe(0);
    });
});
