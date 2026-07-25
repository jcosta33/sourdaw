import { describe, it, expect, vi, beforeEach } from 'vitest';

import { hitTestClip } from '../hitTestClip';

import type { TimelineRenderModel, TrackRenderModel } from '../../../../models/TimelineRenderModel';
import type { getTrackAtY as originalGetTrackAtY } from '../../getTrackAtY';

type ViewState = { pixelsPerBeat: number; scrollX: number; scrollY: number };

const mocks = vi.hoisted(() => {
    const timelineViewStore: { value: ViewState | null } = {
        value: { pixelsPerBeat: 50, scrollX: 0, scrollY: 0 },
    };
    return {
        timelineViewStore,
        buildTimelineRenderModel: vi.fn<() => TimelineRenderModel | null>(),
        getTrackAtY: vi.fn<typeof originalGetTrackAtY>(),
    };
});

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

    it('returns the clip under the cursor when the click lands inside its beat range', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([makeMidiTrack()]));

        // pixelsPerBeat 50, clip spans beat 0..4 => pixels 0..200. X=100 => beat 2 (inside).
        const result = hitTestClip(100, 40);

        expect(result).toEqual({ clipId: 'clip-1', trackId: 'track-1' });
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

    it('returns null when the resolved track index is out of range', () => {
        mocks.getTrackAtY.mockReturnValue({ index: 5, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([makeMidiTrack()]));

        expect(hitTestClip(100, 40)).toBeNull();
    });

    it('returns null when the view state has not loaded', () => {
        mocks.timelineViewStore.value = null;
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([makeMidiTrack()]));

        expect(hitTestClip(100, 40)).toBeNull();
    });

    it('hit-tests individual notes while inline-editing a midi clip', () => {
        const note = { id: 'note-1', startBeat: 1, duration: 1, pitch: 60, velocity: 100 };
        const track = makeMidiTrack();
        track.clips[0]!.isInlineEditing = true;
        track.clips[0]!.midiNotes = [note];
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([track]));

        // Note occupies beat 1..2 => pixel X 50..100; its vertical row sits at
        // contentY ~32..48 for pitch 60 under an 80px track. Click X=75, Y=40.
        const result = hitTestClip(75, 40);

        expect(result).toMatchObject({ clipId: 'clip-1', trackId: 'track-1', noteId: 'note-1', pitch: 60 });
    });

    it('falls back to the whole clip when the inline-edit click misses every note', () => {
        const note = { id: 'note-1', startBeat: 1, duration: 1, pitch: 60, velocity: 100 };
        const track = makeMidiTrack();
        track.clips[0]!.isInlineEditing = true;
        track.clips[0]!.midiNotes = [note];
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([track]));

        // Click inside the clip beat range but far from any note row.
        const result = hitTestClip(75, 1);

        expect(result).toEqual({ clipId: 'clip-1', trackId: 'track-1' });
    });

    it('hit-tests clips inside variation lanes below the main track body', () => {
        const track = makeMidiTrack();
        // Move the main clip out of the way so the beat-range match doesn't win first.
        track.clips[0] = { ...track.clips[0]!, startBeat: 8, endBeat: 12 };
        track.height = 80;
        track.variationLanes = [
            {
                id: 'lane-1',
                name: 'Lane 1',
                clips: [
                    {
                        id: 'var-clip-1',
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Var',
                        color: '#000',
                        type: 'midi',
                        muted: false,
                        isInlineEditing: false,
                        midiNotes: [],
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                ],
            },
        ];
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([track]));

        // Variation lane sits at trackYOffset(0) + trackHeight(80) + 0*24 = 80..104.
        // contentY = canvasY + scrollY(0). Click Y=90 (in lane), X=100 (beat 2).
        const result = hitTestClip(100, 90);

        expect(result).toEqual({ clipId: 'var-clip-1', trackId: 'track-1' });
    });

    it('returns null for a variation-lane click that lands in an empty lane gap', () => {
        const track = makeMidiTrack();
        track.height = 80;
        track.variationLanes = [
            {
                id: 'lane-1',
                name: 'Lane 1',
                clips: [
                    {
                        id: 'var-clip-1',
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Var',
                        color: '#000',
                        type: 'midi',
                        muted: false,
                        isInlineEditing: false,
                        midiNotes: [],
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                    },
                ],
            },
        ];
        mocks.getTrackAtY.mockReturnValue({ index: 0, id: 'track-1' });
        mocks.buildTimelineRenderModel.mockReturnValue(makeRenderModel([track]));

        // In the lane row (Y=90) but past the clip's beat range (X=500 => beat 10).
        expect(hitTestClip(500, 90)).toBeNull();
    });
});
