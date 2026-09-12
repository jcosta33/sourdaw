import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    mapAllTracks: vi.fn<(typeof mapAllTracksRepo)['mapAllTracks']>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { crossfadeClips } from '../crossfadeClips';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as mapAllTracksRepo from '../../../repositories/track/mapAllTracks';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';

function makeClip(id: string, start: number, end: number, overrides: Partial<Clip> = {}): Clip {
    return ClipDummy.create({ id, name: id, startBeat: start, endBeat: end, ...overrides });
}

function makeTrack(clips: Clip[]): Track {
    return TrackDummy.create({ id: 't1', clips });
}

function capturedMapper(): (track: Track) => Track {
    const mapper = mocks.mapAllTracks.mock.calls[0]?.[0];
    if (!mapper) {
        throw new Error('expected mapAllTracks to receive a mapper');
    }
    return mapper;
}

describe('crossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'a' });
    });

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(crossfadeClips('a', 'b')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('does nothing when clips not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack([])], selectedTrackId: 't1' });
        expect(crossfadeClips('missing-a', 'missing-b')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects duplicate clip targets before invoking the mapper', () => {
        const clips = [makeClip('a', 0, 4)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'a')).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects a mixed eligible and ineligible pair before invoking the mapper', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });
        mocks.resolveEligibleClipWriteTarget
            .mockReturnValueOnce({ status: 'eligible', trackId: 't1', clipId: 'a' })
            .mockReturnValueOnce({ status: 'ineligible' });

        expect(crossfadeClips('a', 'b')).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects when clip A is ineligible before even resolving clip B', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });
        mocks.resolveEligibleClipWriteTarget.mockReturnValueOnce({ status: 'ineligible' });

        expect(crossfadeClips('a', 'b')).toBe(false);

        // Clip B is never resolved because clip A short-circuits first.
        expect(mocks.resolveEligibleClipWriteTarget).toHaveBeenCalledTimes(1);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects a non-finite clip A end beat before invoking the mapper', () => {
        const clips = [makeClip('a', 0, Number.NaN), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1)).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects a non-finite clip B start beat before invoking the mapper', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', Number.POSITIVE_INFINITY, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1)).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects finite inputs whose derived crossfade geometry overflows', () => {
        const clips = [makeClip('a', 0, Number.MAX_VALUE), makeClip('b', Number.MAX_VALUE, Number.MAX_VALUE)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', Number.MAX_VALUE)).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('rejects separated clips when the requested duration cannot create an overlap', () => {
        const clips = [makeClip('a', 0, 2), makeClip('b', 6, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1)).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('returns no-write when the requested crossfade already matches project truth', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 0)).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('extends clip A endBeat and clip B startBeat by half the duration each', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const result = capturedMapper()(makeTrack([makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2 })]));

        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipA).toMatchObject({ startBeat: 0, endBeat: 4.5, fadeOutBeats: 1 });
        expect(clipB).toMatchObject({ startBeat: 3.5, endBeat: 8, fadeInBeats: 1 });
    });

    it('uses default duration of 0.5 beats', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        crossfadeClips('a', 'b');

        const result = capturedMapper()(makeTrack([makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2 })]));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipA).toMatchObject({ endBeat: 4.25, fadeOutBeats: 0.5 });
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5 });
    });

    it('clamps clip B start at 0 and widens the overlap accordingly', () => {
        const clips = [makeClip('a', 0, 0.25), makeClip('b', 0.25, 4, { audioOffsetBeats: 1 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        crossfadeClips('a', 'b', 1.0);

        const result = capturedMapper()(
            makeTrack([makeClip('a', 0, 0.25), makeClip('b', 0.25, 4, { audioOffsetBeats: 1 })])
        );
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 0, fadeInBeats: 0.75 });
        expect(clipA).toMatchObject({ endBeat: 0.75, fadeOutBeats: 0.75 });
    });

    it('leaves unrelated clips untouched', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        crossfadeClips('a', 'b', 1.0);

        const other = makeClip('other', 10, 12);
        const result = capturedMapper()(makeTrack([other]));
        expect(result.clips).toEqual([other]);
    });

    it('preserves source-to-timeline alignment for clip B with audioOffsetBeats', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 0.5)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5, audioOffsetBeats: 1.75 });

        // Verify source position at timeline beat 4 is preserved at 2.0
        const sourceAtBeat4 = (clipB?.audioOffsetBeats ?? 0) + (4 - (clipB?.startBeat ?? 0));
        expect(sourceAtBeat4).toBe(2.0);

        // Verify source position at timeline beat 5 (downstream impulse/transient) is preserved at 3.0
        const sourceAtBeat5 = (clipB?.audioOffsetBeats ?? 0) + (5 - (clipB?.startBeat ?? 0));
        expect(sourceAtBeat5).toBe(3.0);
    });

    it('scales audioOffsetBeats by consumed stretch factor when clip B is stretched', () => {
        const clips = [
            makeClip('a', 0, 4),
            makeClip('b', 4, 8, {
                stretchMode: 'timestretch',
                stretchRatio: 2.0,
                audioOffsetBeats: 2,
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 0.5)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5, audioOffsetBeats: 1.5 });

        // Source position at timeline beat 4 is 1.5 + (4 - 3.75) * 2.0 = 2.0 (preserved!)
        const stretchFactor = 2.0;
        const sourceAtBeat4 = (clipB?.audioOffsetBeats ?? 0) + (4 - (clipB?.startBeat ?? 0)) * stretchFactor;
        expect(sourceAtBeat4).toBe(2.0);
    });

    it('preserves source offset invariant with reversed audio clip', () => {
        const clips = [
            makeClip('a', 0, 4),
            makeClip('b', 4, 8, {
                audioOffsetBeats: 1.5,
                audioBufferId: 'reversed-buf',
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 0.5)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5, audioOffsetBeats: 1.25 });

        const sourceAtStart = (clipB?.audioOffsetBeats ?? 0) + (4 - (clipB?.startBeat ?? 0));
        expect(sourceAtStart).toBe(1.5);
    });

    it('clamps clip B extension to available pre-roll handle when handle is smaller than halfDuration', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 0.1 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // Pre-roll handle is 0.1 beats -> clipB start clamps to 3.9, audioOffsetBeats clamps to 0.0
        // clipA ends at 4.5 -> actualOverlap is 4.5 - 3.9 = 0.6
        expect(clipB?.startBeat).toBeCloseTo(3.9);
        expect(clipB?.fadeInBeats).toBeCloseTo(0.6);
        expect(clipB?.audioOffsetBeats).toBeCloseTo(0);
        expect(clipA?.endBeat).toBeCloseTo(4.5);
        expect(clipA?.fadeOutBeats).toBeCloseTo(0.6);
    });

    it('clamps stretched clip B extension to audioOffsetBeats scaled by stretch factor', () => {
        const clips = [
            makeClip('a', 0, 4),
            makeClip('b', 4, 8, {
                stretchMode: 'timestretch',
                stretchRatio: 2.0,
                audioOffsetBeats: 0.2,
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // Available pre-roll handle on timeline is 0.2 / 2.0 = 0.1 beats
        // unclamped start would be 4 - 0.5 = 3.5; clamped start is 4 - 0.1 = 3.9
        // clipBDelta is -0.1, contentDelta is -0.1 * 2.0 = -0.2 -> audioOffsetBeats becomes 0
        // clipA ends at 4.5 -> actualOverlap is 4.5 - 3.9 = 0.6
        expect(clipB?.startBeat).toBeCloseTo(3.9);
        expect(clipB?.fadeInBeats).toBeCloseTo(0.6);
        expect(clipB?.audioOffsetBeats).toBeCloseTo(0);
        expect(clipA?.endBeat).toBeCloseTo(4.5);
        expect(clipA?.fadeOutBeats).toBeCloseTo(0.6);
    });

    it('clamps clip B start at its original start when audioOffsetBeats is 0 (zero pre-roll handle)', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 0 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // Cannot extend earlier than 4 -> startBeat remains 4, audioOffsetBeats remains 0
        // clipA ends at 4.5 -> actualOverlap is 4.5 - 4.0 = 0.5
        expect(clipB).toMatchObject({ startBeat: 4, fadeInBeats: 0.5, audioOffsetBeats: 0 });
        expect(clipA).toMatchObject({ endBeat: 4.5, fadeOutBeats: 0.5 });
    });

    it('clamps MIDI clip B extension to available pre-roll handle when handle is smaller than halfDuration', () => {
        const clips = [
            makeClip('a', 0, 4, { type: 'midi' }),
            makeClip('b', 4, 8, { type: 'midi', midiOffsetBeats: 0.1 }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // Pre-roll handle is 0.1 beats -> clipB start clamps to 3.9, midiOffsetBeats clamps to 0.0
        // clipA ends at 4.5 -> actualOverlap is 4.5 - 3.9 = 0.6
        expect(clipB?.startBeat).toBeCloseTo(3.9);
        expect(clipB?.fadeInBeats).toBeCloseTo(0.6);
        expect(clipB?.midiOffsetBeats).toBeCloseTo(0);
        expect(clipA?.endBeat).toBeCloseTo(4.5);
        expect(clipA?.fadeOutBeats).toBeCloseTo(0.6);
    });

    it('clamps MIDI clip B start at its original start when midiOffsetBeats is 0 (zero pre-roll handle)', () => {
        const clips = [
            makeClip('a', 0, 4, { type: 'midi' }),
            makeClip('b', 4, 8, { type: 'midi', midiOffsetBeats: 0 }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // Cannot extend earlier than 4 -> startBeat remains 4, midiOffsetBeats remains 0
        // clipA ends at 4.5 -> actualOverlap is 4.5 - 4.0 = 0.5
        expect(clipB).toMatchObject({ startBeat: 4, fadeInBeats: 0.5, midiOffsetBeats: 0 });
        expect(clipA).toMatchObject({ endBeat: 4.5, fadeOutBeats: 0.5 });
    });

    it('clamps clip B start at beat zero when source offset allows extending past 0', () => {
        const clips = [makeClip('a', 0, 0.25), makeClip('b', 0.25, 4, { audioOffsetBeats: 1 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        // halfLen is 0.5; unclamped start is 0.25 - 0.5 = -0.25 -> clamps to 0
        // delta is 0 - 0.25 = -0.25 -> audioOffsetBeats becomes 1 - 0.25 = 0.75
        // clipA ends at 0.25 + 0.5 = 0.75 -> overlap is 0.75 - 0 = 0.75
        expect(clipB).toMatchObject({ startBeat: 0, fadeInBeats: 0.75, audioOffsetBeats: 0.75 });
        expect(clipA).toMatchObject({ endBeat: 0.75, fadeOutBeats: 0.75 });
    });

    it('updates midiOffsetBeats when extending a MIDI clip B', () => {
        const clips = [
            makeClip('a', 0, 4, { type: 'midi' }),
            makeClip('b', 4, 8, { type: 'midi', midiOffsetBeats: 2 }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 0.5)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5, midiOffsetBeats: 1.75 });
    });

    it('does not extend untrimmed clip B earlier when audioOffsetBeats is undefined', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 4, fadeInBeats: 0.5 });
        expect(clipB?.audioOffsetBeats).toBeUndefined();
        expect(clipA).toMatchObject({ endBeat: 4.5, fadeOutBeats: 0.5 });
    });

    it('allows audio clip B to extend left when midiOffsetBeats is 0 as set by prepareClipSplit', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8, { audioOffsetBeats: 2, midiOffsetBeats: 0 })];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 3.5, fadeInBeats: 1.0, audioOffsetBeats: 1.5 });
        expect(clipA).toMatchObject({ endBeat: 4.5, fadeOutBeats: 1.0 });
    });
});
