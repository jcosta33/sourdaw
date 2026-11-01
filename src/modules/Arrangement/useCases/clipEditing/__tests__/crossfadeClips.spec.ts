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

import { defaultTransportState, readSecondsAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { crossfadeClips } from '../crossfadeClips';
import { restoreCrossfadeClips } from '../restoreCrossfadeClips';

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

/** The source second the live and offline readers play at `beat` inside an unlooped clip. */
function readerSourceSecondsAt(clip: Clip, beat: number): number {
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: clip.endBeat - clip.startBeat,
        iterationStartBeat: beat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1,
        tempoAtClipStart: 120,
        secondsAtBeat: (at) => readSecondsAtBeat({ beat: at }),
    })[0];
    if (!segment) {
        throw new Error('the readers project no segment for the clip');
    }
    return segment.sourceStartSeconds;
}

/** The source second the readers play at `beat`, on the loop grid the scheduler projects for the clip. */
function loopedReaderSourceSecondsAt(clip: Clip, beat: number): number {
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: loop.loopLengthBeats,
        iterationStartBeat: beat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1,
        tempoAtClipStart: 60,
        secondsAtBeat: (at) => readSecondsAtBeat({ beat: at }),
    })[0];
    if (!segment) {
        throw new Error('the readers project no segment for the clip');
    }
    return segment.sourceStartSeconds;
}

describe('crossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'a' });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, tempo: 60 });
    });

    describe('canonical clip B source entry', () => {
        function crossfadeB(clipB: Clip, clipAEnd: number, durationBeats: number): Clip {
            const track = makeTrack([makeClip('a', 0, clipAEnd), clipB]);
            mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' });
            expect(crossfadeClips('a', 'b', durationBeats)).toBe(true);
            const result = capturedMapper()(track).clips.find((clip) => clip.id === 'b');
            if (!result) {
                throw new Error('expected clip B in the mapper result');
            }
            return result;
        }

        it('retreats the entry by the source seconds the retreat spans across a tempo change', () => {
            // 120 BPM to beat 8, then 60. Clip B retreats from 8.25 to 7.75:
            // 0.25 beat at 120 plus 0.25 beat at 60 is 0.375 s of source.
            tempoMapStore.set({
                changes: [
                    { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' },
                ],
            });
            const before = makeClip('b', 8.25, 12, {
                audioOffsetBeats: 4,
                audioOffsetSeconds: 2,
                audioUnwrappedOffsetSeconds: 2.5,
            });

            const after = crossfadeB(before, 8, 1);

            expect(after.startBeat).toBe(7.75);
            expect(after.audioOffsetSeconds).toBeCloseTo(1.625, 12);
            expect(after.audioUnwrappedOffsetSeconds).toBeCloseTo(2.125, 12);
            // The material at the old start, and downstream of it, stays on its beat.
            expect(readerSourceSecondsAt(after, 8.25)).toBeCloseTo(readerSourceSecondsAt(before, 8.25), 12);
            expect(readerSourceSecondsAt(after, 10)).toBeCloseTo(readerSourceSecondsAt(before, 10), 12);
        });

        it('bounds the retreat by the canonical pre-roll, not the legacy beat offset', () => {
            // 0.25 s of media before the entry at 60 BPM allows a quarter beat,
            // though the stale beat offset would allow four.
            const after = crossfadeB(makeClip('b', 10, 14, { audioOffsetBeats: 4, audioOffsetSeconds: 0.25 }), 10, 2);

            expect(after.startBeat).toBe(9.75);
            expect(after.fadeInBeats).toBe(1.25);
            expect(after.audioOffsetSeconds).toBeCloseTo(0, 12);
            expect(after.audioOffsetSeconds).toBeGreaterThanOrEqual(0);
        });

        it('bounds a stretched retreat by the pre-roll the stretched readers consume', () => {
            // 0.5 s of media before the entry at ratio 2 lasts 0.25 s of song
            // time, a quarter beat at 60 BPM, though the crossfade asks for one.
            const before = makeClip('b', 10, 14, {
                audioOffsetSeconds: 0.5,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            });

            const after = crossfadeB(before, 10, 2);

            expect(after.startBeat).toBe(9.75);
            expect(after.audioOffsetSeconds).toBeCloseTo(0, 12);
            expect(after.audioOffsetSeconds).toBeGreaterThanOrEqual(0);
            expect(readerSourceSecondsAt(after, 10)).toBeCloseTo(0.5, 12);
        });

        it('keeps a signed leading-silence entry and its start in place', () => {
            const after = crossfadeB(makeClip('b', 10, 14, { audioOffsetBeats: 1, audioOffsetSeconds: -0.5 }), 10, 2);

            expect(after.startBeat).toBe(10);
            expect(after.audioOffsetSeconds).toBe(-0.5);
            expect(after.fadeInBeats).toBe(1);
        });

        it('retreats a stretched entry by the source the stretched readers consume', () => {
            const before = makeClip('b', 10, 14, {
                audioOffsetSeconds: 3,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            });

            const after = crossfadeB(before, 10, 1);

            expect(after.startBeat).toBe(9.5);
            expect(after.audioOffsetSeconds).toBeCloseTo(2, 12);
            expect(readerSourceSecondsAt(after, 10)).toBeCloseTo(3, 12);
        });

        it('keeps a looped stretched clip B on its loop phase at every beat from its old start', () => {
            const before = makeClip('b', 4, 8, {
                stretchMode: 'timestretch',
                stretchRatio: 2,
                loopEnabled: true,
                loopLength: 2,
                loopOriginBeat: 4,
                audioLoopPassOriginBeat: 4,
                audioOffsetBeats: 2,
                audioOffsetSeconds: 2,
                audioUnwrappedOffsetSeconds: 2,
                audioLoopStartSeconds: 2,
                audioLoopPassEntrySeconds: 2,
            });
            const beats = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
            const readsBefore = beats.map((beat) => loopedReaderSourceSecondsAt(before, beat));
            expect(readsBefore).toEqual([2, 3, 4, 5, 2, 3, 4, 5]);

            const after = crossfadeB(before, 4, 1);

            expect(after.startBeat).toBe(3.5);
            for (const [index, beat] of beats.entries()) {
                expect(loopedReaderSourceSecondsAt(after, beat), `beat ${beat}`).toBeCloseTo(readsBefore[index]!, 12);
            }
            // The revealed half beat plays the stretched handle before the entry.
            expect(loopedReaderSourceSecondsAt(after, 3.5)).toBeCloseTo(1, 12);
        });

        it('keeps an independent first entry by not retreating past the loop part it opens', () => {
            // The entry at 3 s is off the repeat grid (the head reads 0 s at 4,
            // so 1 s at 5). Retreating into the previous pass would hand beat 5
            // back to the grid, so the retreat stops at the part start, 4.
            const before = makeClip('b', 5, 9, {
                loopEnabled: true,
                loopLength: 2,
                loopOriginBeat: 4,
                audioLoopPassOriginBeat: 4,
                audioOffsetSeconds: 3,
                audioUnwrappedOffsetSeconds: 3,
                audioLoopStartSeconds: 0,
                audioLoopPassEntrySeconds: 0,
            });
            const beats = [5, 5.5, 6, 7, 8, 8.5];
            const readsBefore = beats.map((beat) => loopedReaderSourceSecondsAt(before, beat));

            const after = crossfadeB(before, 5, 4);

            expect(after.startBeat).toBe(4);
            expect(after.audioOffsetSeconds).toBeCloseTo(2, 12);
            for (const [index, beat] of beats.entries()) {
                expect(loopedReaderSourceSecondsAt(after, beat), `beat ${beat}`).toBeCloseTo(readsBefore[index]!, 12);
            }
        });

        it('mints no canonical fields on a beat-only clip B', () => {
            const after = crossfadeB(makeClip('b', 4, 8, { audioOffsetBeats: 2 }), 4, 0.5);

            expect(after).toMatchObject({ startBeat: 3.75, audioOffsetBeats: 1.75 });
            expect(Object.hasOwn(after, 'audioOffsetSeconds')).toBe(false);
            expect(Object.hasOwn(after, 'audioUnwrappedOffsetSeconds')).toBe(false);
        });
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

    it.each([
        { stretchRatio: 1, loopOriginBeat: undefined },
        { stretchRatio: 1, loopOriginBeat: 4 },
        { stretchRatio: 2, loopOriginBeat: undefined },
        { stretchRatio: 2, loopOriginBeat: 4 },
    ])(
        'preserves recorded leading silence at stretch $stretchRatio with anchor $loopOriginBeat',
        ({ stretchRatio, loopOriginBeat }) => {
            // A recording begun inside a loop starts its clip before captured media.
            const clipOverrides: Partial<Clip> = {
                audioOffsetBeats: -1,
                stretchMode: 'timestretch',
                stretchRatio,
                loopEnabled: true,
                loopLength: 4,
            };
            if (loopOriginBeat !== undefined) {
                clipOverrides.loopOriginBeat = loopOriginBeat;
            }
            const recordedClip = makeClip('b', 4, 8, clipOverrides);
            const track = makeTrack([makeClip('a', 0, 4), recordedClip]);
            mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' });
            const mediaOrigin = recordedClip.startBeat - recordedClip.audioOffsetBeats! / stretchRatio;
            const transientBeat = mediaOrigin + 1 / stretchRatio;

            expect(crossfadeClips('a', 'b', 1)).toBe(true);

            const result = capturedMapper()(track);
            const clipB = result.clips.find((clip) => clip.id === 'b');
            if (!clipB) {
                throw new Error('Expected recorded clip B');
            }
            expect(result.clips[0]).toMatchObject({ endBeat: 4.5, fadeOutBeats: 0.5 });
            expect(clipB).toMatchObject({ startBeat: 4, endBeat: 8, fadeInBeats: 0.5 });
            expect.soft(clipB.audioOffsetBeats).toBe(-1);
            expect.soft(clipB.startBeat - clipB.audioOffsetBeats! / stretchRatio).toBe(mediaOrigin);
            expect.soft(clipB.audioOffsetBeats! + (transientBeat - clipB.startBeat) * stretchRatio).toBe(1);
            expect(clipB.loopOriginBeat).toBe(loopOriginBeat);
            expect(Object.hasOwn(clipB, 'loopOriginBeat')).toBe(loopOriginBeat !== undefined);
        }
    );

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

    it('shifts a looped stretched clip B anchor so the crossfade keeps the loop region', () => {
        // The finding's figures: clipA [0,8), clipB [8,16) looped at 8 with
        // offset 4 — region [4,8), advance 0 — and ratio 2. A 1-beat
        // crossfade retreats the start by the raw −0.5 and the offset by the
        // stretched −1: carried unshifted, the anchor 8 derives advance −0.5
        // and the region reads 3.5 at entry phase 3.5, displaced by
        // −0.5 × (2 − 1) source beats. The anchor therefore shifts by
        // clipBDelta − contentDelta = +0.5 to 8.5: advance −1 recovers the
        // region 3 − (−1) = 4, and the head's entry phase −1 mod 4 = 3 is the
        // region tail the pre-roll plays cyclically before the seam — at the
        // overlap beat 8 the read is 3 + 0.5 × 2 = 4, the source's own head
        // entry, unbroken under the fade.
        const clips = [
            makeClip('a', 0, 8),
            makeClip('b', 8, 16, {
                stretchMode: 'timestretch',
                stretchRatio: 2.0,
                audioOffsetBeats: 4,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 8,
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        if (!clipB) {
            throw new Error('expected clip B in the mapper result');
        }
        expect(clipB.startBeat).toBe(7.5);
        expect(clipB.audioOffsetBeats).toBe(3);
        expect(clipB.loopOriginBeat).toBe(8.5);
        const advance = clipB.startBeat - (clipB.loopOriginBeat ?? clipB.startBeat);
        expect((clipB.audioOffsetBeats ?? 0) - advance).toBe(4);
        // The seam continuity: at the old boundary beat 8 the stretched read
        // is the source's own entry into the region.
        expect((clipB.audioOffsetBeats ?? 0) + (8 - clipB.startBeat) * 2.0).toBe(4);
    });

    it('keeps an unstretched looped clip B anchor and region exactly', () => {
        // Stretch off ignores the dormant ratio: contentDelta equals
        // clipBDelta, the anchor shift is zero, and the carried anchor keeps
        // the advance at −0.5 so the region stays the source's own.
        const clips = [
            makeClip('a', 0, 8),
            makeClip('b', 8, 16, {
                audioOffsetBeats: 4,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 8,
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        if (!clipB) {
            throw new Error('expected clip B in the mapper result');
        }
        expect(clipB.startBeat).toBe(7.5);
        expect(clipB.audioOffsetBeats).toBe(3.5);
        expect(clipB.loopOriginBeat).toBe(8);
        const advance = clipB.startBeat - (clipB.loopOriginBeat ?? clipB.startBeat);
        expect((clipB.audioOffsetBeats ?? 0) - advance).toBe(4);
    });

    it('leaves a looped MIDI clip B anchor untouched as its offset retreats by the raw delta', () => {
        // The MIDI offset retreats by the raw clipBDelta, so the carried
        // anchor derives the same advance as before the crossfade: shifting
        // it would slide the region. The anchor rides unchanged.
        const clips = [
            makeClip('a', 0, 8, { type: 'midi' }),
            makeClip('b', 8, 16, {
                type: 'midi',
                midiOffsetBeats: 4,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 8,
            }),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(clips)], selectedTrackId: 't1' });

        expect(crossfadeClips('a', 'b', 1.0)).toBe(true);

        const result = capturedMapper()(makeTrack(clips));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 7.5, midiOffsetBeats: 3.5, loopOriginBeat: 8 });
    });
});

describe('restoreCrossfadeClips — the undo leg restores the captured anchor (#5198)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'a' });
    });

    function postCrossfadeClips(): Clip[] {
        // What the forward leg left: start 7.5, offset 3, anchor shifted to
        // 8.5 (advance -0.5, region still 4).
        return [
            makeClip('a', 0, 8.5, { fadeOutBeats: 1 }),
            makeClip('b', 7.5, 16, {
                stretchMode: 'timestretch',
                stretchRatio: 2.0,
                audioOffsetBeats: 3,
                fadeInBeats: 1,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 8.5,
            }),
        ];
    }

    it('round-trips the anchor and region of a stretched crossfade to the pre-crossfade values', () => {
        const replacement = {
            clipAEndBeat: 8,
            clipAFadeOutBeats: 0,
            clipBStartBeat: 8,
            clipBFadeInBeats: 0,
            clipBAudioOffsetBeats: 4,
            clipBLoopOriginBeat: 8,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(postCrossfadeClips())], selectedTrackId: 't1' });

        expect(restoreCrossfadeClips({ clipAId: 'a', clipBId: 'b', replacement })).toBe(true);

        const result = capturedMapper()(makeTrack(postCrossfadeClips()));
        const clipB = result.clips.find((context) => context.id === 'b');
        if (!clipB) {
            throw new Error('expected clip B in the mapper result');
        }
        expect(clipB).toMatchObject({ startBeat: 8, audioOffsetBeats: 4, loopOriginBeat: 8 });
        const advance = clipB.startBeat - (clipB.loopOriginBeat ?? clipB.startBeat);
        expect((clipB.audioOffsetBeats ?? 0) - advance).toBe(4);
    });

    it('decodes a legacy replacement without the anchor and leaves the live anchor untouched', () => {
        const replacement = {
            clipAEndBeat: 8,
            clipAFadeOutBeats: 0,
            clipBStartBeat: 8,
            clipBFadeInBeats: 0,
            clipBAudioOffsetBeats: 4,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [makeTrack(postCrossfadeClips())], selectedTrackId: 't1' });

        expect(restoreCrossfadeClips({ clipAId: 'a', clipBId: 'b', replacement })).toBe(true);

        const result = capturedMapper()(makeTrack(postCrossfadeClips()));
        const clipB = result.clips.find((context) => context.id === 'b');
        expect(clipB).toMatchObject({ startBeat: 8, audioOffsetBeats: 4, loopOriginBeat: 8.5 });
    });
});
