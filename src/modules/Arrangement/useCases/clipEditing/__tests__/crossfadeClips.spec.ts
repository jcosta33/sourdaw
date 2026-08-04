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

function makeClip(id: string, start: number, end: number): Clip {
    return ClipDummy.create({ id, name: id, startBeat: start, endBeat: end });
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
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const result = capturedMapper()(makeTrack([makeClip('a', 0, 4), makeClip('b', 4, 8)]));

        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipA).toMatchObject({ startBeat: 0, endBeat: 4.5, fadeOutBeats: 1 });
        expect(clipB).toMatchObject({ startBeat: 3.5, endBeat: 8, fadeInBeats: 1 });
    });

    it('uses default duration of 0.5 beats', () => {
        const clips = [makeClip('a', 0, 4), makeClip('b', 4, 8)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        crossfadeClips('a', 'b');

        const result = capturedMapper()(makeTrack([makeClip('a', 0, 4), makeClip('b', 4, 8)]));
        const clipA = result.clips.find((context) => context.id === 'a');
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipA).toMatchObject({ endBeat: 4.25, fadeOutBeats: 0.5 });
        expect(clipB).toMatchObject({ startBeat: 3.75, fadeInBeats: 0.5 });
    });

    it('clamps clip B start at 0 and widens the overlap accordingly', () => {
        const clips = [makeClip('a', 0, 0.25), makeClip('b', 0.25, 4)];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        crossfadeClips('a', 'b', 1.0);

        const result = capturedMapper()(makeTrack([makeClip('a', 0, 0.25), makeClip('b', 0.25, 4)]));
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
});
