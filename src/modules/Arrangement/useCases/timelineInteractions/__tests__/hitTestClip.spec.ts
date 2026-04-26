import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { hitTestClip } from '../hitTestClip/hitTestClip';
import { hitTestTrack } from '../hitTestClip/hitTestTrack';

import type { TimelineViewState } from '../../../stores/timelineViewStore';

let mockTimelineViewValue: TimelineViewState | null = null;
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return mockTimelineViewValue;
        },
    },
}));

const mockBuildTimelineRenderModel = vi.fn<(...args: unknown[]) => TimelineRenderModel | null>();
vi.mock('../../buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: () => mockBuildTimelineRenderModel(),
}));

const mockGetTrackAtY = vi.fn<(...args: unknown[]) => { index: number; id: string } | null>();
vi.mock('../getTrackAtY', () => ({
    getTrackAtY: (...args: unknown[]) => mockGetTrackAtY(...args),
}));

describe('hitTestClip', () => {
    const mockModel: TimelineRenderModel = {
        dataDirty: false,
        tracks: [
            {
                id: 't1',
                name: 'One',
                index: 0,
                kind: 'midi',
                color: '#000',
                muted: false,
                soloed: false,
                height: 64,
                clips: [
                    {
                        id: 'c1',
                        startBeat: 0,
                        endBeat: 8,
                        name: 'Clip',
                        color: '#000',
                        type: 'midi',
                        muted: false,
                        midiNotes: [],
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                ],
                automationMode: 'read',
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 32,
        beatsPerPixel: 0.1,
        pixelsPerBeat: 10,
        trackHeight: 48,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };

    beforeEach(() => {
        mockTimelineViewValue = null;
        mockBuildTimelineRenderModel.mockReset();
        mockGetTrackAtY.mockReset();
    });

    it('returns clip and track when beat falls inside a clip', () => {
        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 } as unknown as TimelineViewState;
        mockBuildTimelineRenderModel.mockReturnValue(mockModel);
        mockGetTrackAtY.mockReturnValue({ index: 0, id: 't1' });

        const hit = hitTestClip(25, 10);
        expect(hit).toEqual({ clipId: 'c1', trackId: 't1' });
    });

    it('returns null when there is no view state', () => {
        mockTimelineViewValue = null;
        mockBuildTimelineRenderModel.mockReturnValue(mockModel);
        mockGetTrackAtY.mockReturnValue({ index: 0, id: 't1' });

        expect(hitTestClip(0, 0)).toBeNull();
    });
});

describe('hitTestTrack', () => {
    beforeEach(() => {
        mockTimelineViewValue = null;
        mockBuildTimelineRenderModel.mockReset();
        mockGetTrackAtY.mockReset();
    });

    it('returns track id at y', () => {
        const mockModel: TimelineRenderModel = {
            dataDirty: false,
            tracks: [
                {
                    id: 't1',
                    name: 'One',
                    index: 0,
                    kind: 'midi',
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 64,
                    clips: [],
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 0,
            viewportEndBeat: 32,
            beatsPerPixel: 0.1,
            pixelsPerBeat: 10,
            trackHeight: 48,
            scrollY: 0,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };

        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 } as unknown as TimelineViewState;
        mockBuildTimelineRenderModel.mockReturnValue(mockModel);
        mockGetTrackAtY.mockReturnValue({ index: 0, id: 't1' });

        expect(hitTestTrack(10)).toBe('t1');
    });
});
