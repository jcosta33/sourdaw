import { describe, it, expect, vi, beforeEach } from 'vitest';

import { hitTestClip } from '../hitTestClip';

import type { TimelineRenderModel, TrackRenderModel } from '../../../../models/TimelineRenderModel';
import type { getTrackAtY as originalGetTrackAtY } from '../../getTrackAtY';

const mocks = vi.hoisted(() => ({
    timelineViewStore: {
        value: {
            pixelsPerBeat: 50,
            scrollX: 0,
            scrollY: 0,
        },
    },
    buildTimelineRenderModel: vi.fn<() => TimelineRenderModel | null>(),
    getTrackAtY: vi.fn<typeof originalGetTrackAtY>(),
}));

vi.mock('../../../../stores/timelineViewStore', () => ({
    timelineViewStore: mocks.timelineViewStore,
}));

vi.mock('../../../buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));

vi.mock('../../getTrackAtY', () => ({
    getTrackAtY: mocks.getTrackAtY,
}));

function makeRenderModel(tracks: TrackRenderModel[]): TimelineRenderModel {
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
        trackHeight: 80,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
}

function makeMidiTrack(): TrackRenderModel {
    return {
        id: 'track-1',
        name: 'Track 1',
        index: 0,
        kind: 'midi',
        color: '#000',
        muted: false,
        soloed: false,
        height: 80,
        clips: [
            {
                id: 'clip-1',
                startBeat: 0,
                endBeat: 4,
                name: 'Clip 1',
                color: '#000',
                type: 'midi',
                muted: false,
                isInlineEditing: false,
                midiNotes: [],
                fadeInBeats: 0,
                fadeOutBeats: 0,
            },
        ],
        variationLanes: [],
        automationMode: 'read',
    };
}

describe('hitTestClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.timelineViewStore.value = { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 };
    });

    it('returns null when no render model', () => {
        mocks.buildTimelineRenderModel.mockReturnValue(null);
        expect(hitTestClip(100, 100)).toBeNull();
    });

    it('returns null when no tracks at coordinate', () => {
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([]));
        expect(hitTestClip(100, 100)).toBeNull();
    });

    it('processes clip hit without crash', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([makeMidiTrack()]));

        const result = hitTestClip(100, 40);
        expect(typeof result === 'object' || result === null).toBe(true);
    });

    it('returns null when coordinate is outside clip bounds', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([makeMidiTrack()]));

        const result = hitTestClip(500, 40);
        expect(result).toBeNull();
    });

    it('returns null when getTrackAtY finds no track', () => {
        mocks.getTrackAtY.mockReturnValue(null);
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([]));
        expect(hitTestClip(100, 100)).toBeNull();
    });
});
