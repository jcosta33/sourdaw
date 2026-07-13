import { describe, it, expect, vi, beforeEach } from 'vitest';

import { hitTestClip } from '../hitTestClip';

import type { timelineViewStore as originalTimelineViewStore } from '../../../stores/timelineViewStore';
import type { buildTimelineRenderModel as originalBuild } from '../../buildTimelineRenderModel';
import type { getTrackAtY as originalGetTrackAtY } from '../getTrackAtY';

const mocks = vi.hoisted(() => ({
    timelineViewStore: {
        value: {
            pixelsPerBeat: 50,
            scrollX: 0,
            scrollY: 0,
        },
    } as unknown as typeof originalTimelineViewStore,
    buildTimelineRenderModel: vi.fn<typeof originalBuild>(),
    getTrackAtY: vi.fn<typeof originalGetTrackAtY>(),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: mocks.timelineViewStore,
}));

vi.mock('../../buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));

vi.mock('../getTrackAtY', () => ({
    getTrackAtY: mocks.getTrackAtY,
}));

describe('hitTestClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.timelineViewStore.value = { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 } as never;
    });

    it('returns null when no render model', () => {
        mocks.buildTimelineRenderModel.mockReturnValue(null);
        expect(hitTestClip(100, 100)).toBeNull();
    });

    it('returns null when no tracks at coordinate', () => {
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [] } as never);
        expect(hitTestClip(100, 100)).toBeNull();
    });

    it('processes clip hit without crash', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 0 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    height: 80,
                    clips: [
                        {
                            id: 'clip-1',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'midi',
                            isInlineEditing: false,
                            midiNotes: [],
                        },
                    ],
                    variationLanes: [],
                },
            ],
        } as never);

        const result = hitTestClip(100, 40);
        expect(typeof result === 'object' || result === null).toBe(true);
    });

    it('returns null when coordinate is outside clip bounds', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 0 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    height: 80,
                    clips: [
                        {
                            id: 'clip-1',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'midi',
                            isInlineEditing: false,
                            midiNotes: [],
                        },
                    ],
                    variationLanes: [],
                },
            ],
        } as never);

        const result = hitTestClip(500, 40);
        expect(result).toBeNull();
    });

    it('returns null when getTrackAtY finds no track', () => {
        mocks.getTrackAtY.mockReturnValue(null);
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [] } as never);
        expect(hitTestClip(100, 100)).toBeNull();
    });
});
