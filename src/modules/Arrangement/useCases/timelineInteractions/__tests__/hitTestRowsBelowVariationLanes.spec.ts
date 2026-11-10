import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type ClipRenderModel,
    type TimelineRenderModel,
    type TrackRenderModel,
} from '../../../models/TimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';
import { hitTestClip } from '../hitTestClip/hitTestClip';
import { hitTestTrack } from '../hitTestClip/hitTestTrack';
import { hitTestClipEdge } from '../hitTestClipEdge';

const mocks = vi.hoisted(() => ({
    buildTimelineRenderModel: vi.fn<() => TimelineRenderModel>(),
    timelineViewStore: { value: { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 } },
}));

vi.mock('../../buildTimelineRenderModel', () => ({ buildTimelineRenderModel: mocks.buildTimelineRenderModel }));
vi.mock('../../../stores/timelineViewStore', () => ({ timelineViewStore: mocks.timelineViewStore }));

function makeClip(id: string): ClipRenderModel {
    return {
        id,
        startBeat: 0,
        endBeat: 8,
        name: id,
        color: '#000',
        type: 'audio',
        muted: false,
        midiNotes: [],
        fadeInBeats: 0,
        fadeOutBeats: 0,
    };
}

function makeVariationLanes(id: string, laneCount: number): TrackRenderModel['variationLanes'] {
    if (laneCount === 0) {
        return undefined;
    }
    return Array.from({ length: laneCount }, (_, lane) => ({
        id: `${id}-lane-${lane}`,
        name: `Alt ${lane + 1}`,
        clips: [makeClip(`${id}-lane-${lane}-clip`)],
    }));
}

function makeTrack(id: string, index: number, laneCount: number): TrackRenderModel {
    return {
        id,
        name: id,
        index,
        kind: 'audio',
        color: '#000',
        muted: false,
        soloed: false,
        height: 64,
        clips: [makeClip(`${id}-clip`)],
        variationLanes: makeVariationLanes(id, laneCount),
        automationMode: 'read',
    };
}

function makeModel(tracks: TrackRenderModel[]): TimelineRenderModel {
    return {
        dataDirty: false,
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 32,
        beatsPerPixel: 1 / 50,
        pixelsPerBeat: 50,
        trackHeight: 64,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
}

// Track "upper" is 0..64 with two 24px lanes at 64..88 and 88..112; "lower" starts at 112.
describe('rows below a track with variation lanes', () => {
    beforeEach(() => {
        mocks.timelineViewStore.value = { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 };
        mocks.buildTimelineRenderModel.mockReturnValue(makeModel([makeTrack('upper', 0, 2), makeTrack('lower', 1, 0)]));
    });

    it('resolves the first row of the next track to that track, not to the lanes above it', () => {
        expect(getTrackAtY(makeModel([makeTrack('upper', 0, 2), makeTrack('lower', 1, 0)]).tracks, 112)).toEqual({
            index: 1,
            id: 'lower',
        });
        expect(hitTestTrack(112)).toBe('lower');
        expect(hitTestTrack(111)).toBe('upper');
        expect(hitTestClip(100, 112)).toEqual({ clipId: 'lower-clip', trackId: 'lower' });
        expect(hitTestClipEdge(100, 112)).toEqual({ clipId: 'lower-clip', trackId: 'lower', edge: 'body' });
    });

    it('keeps the lane band owned by the track that hosts it', () => {
        expect(hitTestTrack(64)).toBe('upper');
        expect(hitTestTrack(100)).toBe('upper');
        expect(hitTestTrack(111)).toBe('upper');
    });

    it('hits the lane clip, not the main clip, while the pointer is in the lane band', () => {
        expect(hitTestClip(100, 70)).toEqual({ clipId: 'upper-lane-0-clip', trackId: 'upper' });
        expect(hitTestClip(100, 100)).toEqual({ clipId: 'upper-lane-1-clip', trackId: 'upper' });
        expect(hitTestClip(100, 10)).toEqual({ clipId: 'upper-clip', trackId: 'upper' });
    });

    it('reports no clip edge inside the lane band', () => {
        expect(hitTestClipEdge(100, 70)).toBeNull();
    });

    it('follows the scroll offset into the lane band', () => {
        mocks.timelineViewStore.value = { pixelsPerBeat: 50, scrollX: 0, scrollY: 100 };

        expect(hitTestTrack(0)).toBe('upper');
        expect(hitTestTrack(12)).toBe('lower');
    });
});
