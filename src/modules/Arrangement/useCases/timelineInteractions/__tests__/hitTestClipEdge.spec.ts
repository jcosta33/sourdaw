import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { hitTestClipEdge } from '../hitTestClipEdge';

const { 
    mockTimelineViewValue, 
    mockBuildTimelineRenderModel,
    mockGetTrackAtY
} = vi.hoisted(() => ({
    mockTimelineViewValue: { value: null } as any,
    mockBuildTimelineRenderModel: vi.fn(),
    mockGetTrackAtY: vi.fn(),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: { get value() { return mockTimelineViewValue.value; } }
}));

vi.mock('../../buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: () => mockBuildTimelineRenderModel()
}));

vi.mock('../getTrackAtY', () => ({
    getTrackAtY: (...args: any[]) => mockGetTrackAtY(...args)
}));

describe('hitTestClipEdge', () => {
    const baseModel: TimelineRenderModel = {
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

    function setup(): void {
        mockTimelineViewValue.value = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockBuildTimelineRenderModel.mockReturnValue(baseModel);
        mockGetTrackAtY.mockReturnValue({ index: 0, id: 't1' });
    }

    beforeEach(() => {
        mockTimelineViewValue.value = null;
        mockBuildTimelineRenderModel.mockReset();
        mockGetTrackAtY.mockReset();
    });

    it('detects left edge near clip start in pixels', () => {
        setup();
        expect(hitTestClipEdge(5, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'left' });
    });

    it('detects right edge near clip end in pixels', () => {
        setup();
        expect(hitTestClipEdge(75, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'right' });
    });

    it('detects body away from edges', () => {
        setup();
        expect(hitTestClipEdge(40, 10)).toEqual({ clipId: 'c1', trackId: 't1', edge: 'body' });
    });

    it('returns null when view state is missing', () => {
        mockTimelineViewValue.value = null;
        mockBuildTimelineRenderModel.mockReturnValue(baseModel);
        mockGetTrackAtY.mockReturnValue({ index: 0, id: 't1' });
        expect(hitTestClipEdge(0, 0)).toBeNull();
    });
});


