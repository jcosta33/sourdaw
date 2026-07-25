import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildTimelineRenderModel: vi.fn<(typeof renderModelModule)['buildTimelineRenderModel']>(),
    timelineViewStore: { value: null as { scrollY: number } | null },
}));

vi.mock('../../../buildTimelineRenderModel', () => ({ buildTimelineRenderModel: mocks.buildTimelineRenderModel }));
vi.mock('../../../../stores/timelineViewStore', () => ({ timelineViewStore: mocks.timelineViewStore }));

import { type TimelineRenderModel, type TrackRenderModel } from '../../../../models/TimelineRenderModel';
import { hitTestTrack } from '../hitTestTrack';

import type * as renderModelModule from '../../../buildTimelineRenderModel';

function makeTrackRow(id: string, index: number, height: number): TrackRenderModel {
    return {
        id,
        name: id,
        index,
        kind: 'audio',
        color: '#123456',
        muted: false,
        soloed: false,
        height,
        clips: [],
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
        viewportEndBeat: 16,
        beatsPerPixel: 0.05,
        pixelsPerBeat: 20,
        trackHeight: 80,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
}

describe('hitTestTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.timelineViewStore.value = null;
        mocks.buildTimelineRenderModel.mockReturnValue(
            makeModel([makeTrackRow('t1', 0, 80), makeTrackRow('t2', 1, 60)])
        );
    });

    it('returns the track whose lane contains the y position', () => {
        expect(hitTestTrack(10)).toBe('t1');
        expect(hitTestTrack(100)).toBe('t2');
    });

    it('returns null when y falls below the last track lane', () => {
        expect(hitTestTrack(200)).toBeNull();
    });

    it('offsets the hit by the current vertical scroll', () => {
        mocks.timelineViewStore.value = { scrollY: 80 };
        expect(hitTestTrack(10)).toBe('t2');
    });

    it('clamps negative positions to the first track', () => {
        expect(hitTestTrack(-25)).toBe('t1');
    });

    it('returns null when the render model cannot be built (no tracks in state)', () => {
        mocks.buildTimelineRenderModel.mockReturnValue(null as unknown as TimelineRenderModel);

        expect(hitTestTrack(10)).toBeNull();
    });
});
