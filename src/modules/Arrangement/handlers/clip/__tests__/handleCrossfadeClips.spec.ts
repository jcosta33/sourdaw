import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleCrossfadeClips } from '../handleCrossfadeClips';
import { handleRestoreCrossfadeClips } from '../handleRestoreCrossfadeClips';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as mapAllTracksRepo from '../../../repositories/track/mapAllTracks';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
import type * as crossfadeModule from '../../../useCases/clipEditing/crossfadeClips';
import type * as trackStoreStateModule from '../../../useCases/getTrackStoreState';

const mocks = vi.hoisted(() => ({
    crossfadeClips: vi.fn<(typeof crossfadeModule)['crossfadeClips']>(),
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    getTrackStoreState: vi.fn<(typeof trackStoreStateModule)['getTrackStoreState']>(),
    mapAllTracks: vi.fn<(typeof mapAllTracksRepo)['mapAllTracks']>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../useCases/clipEditing/crossfadeClips', () => ({
    crossfadeClips: mocks.crossfadeClips,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));
vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));
vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleCrossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.crossfadeClips.mockReturnValue(true);
        const trackState = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [
                        ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, fadeInBeats: 0, fadeOutBeats: 0 }),
                        ClipDummy.create({ id: 'c2', startBeat: 4, endBeat: 8, fadeInBeats: 0, fadeOutBeats: 0 }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
        };
        mocks.getTrackStoreState.mockReturnValue(trackState);
        mocks.getTrackState.mockReturnValue(trackState);
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }) => ({
            status: 'eligible',
            trackId: 'track-1',
            clipId,
        }));
    });

    it('executes crossfadeClips with the provided payload', () => {
        const result = handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });

        expect(mocks.crossfadeClips).toHaveBeenCalledWith('c1', 'c2', 0.5);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the crossfade is rejected', () => {
        mocks.crossfadeClips.mockReturnValue(false);

        const result = handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });
        expect(desc.label).toBe('Crossfade clips');
    });

    it('describes compensating undo and redo snapshots for both clips', () => {
        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4.5, clipAFadeOutBeats: 1, clipBStartBeat: 3.5, clipBFadeInBeats: 1 },
                replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
                replacement: { clipAEndBeat: 4.5, clipAFadeOutBeats: 1, clipBStartBeat: 3.5, clipBFadeInBeats: 1 },
            },
        });
    });

    it('is undoable', () => {
        expect(handleCrossfadeClips.undoable).toBe(true);
    });

    it('atomically restores both clip snapshots when compensation expectations still match', () => {
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
                replacement: { clipAEndBeat: 3.5, clipAFadeOutBeats: 0.5, clipBStartBeat: 3.5, clipBFadeInBeats: 0.5 },
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const mapper = mocks.mapAllTracks.mock.calls[0]?.[0];
        const track = mocks.getTrackStoreState()?.tracks[0];
        if (!mapper || !track) {
            throw new Error('Expected mapAllTracks mapper and track fixture');
        }
        expect(mapper(track)).toMatchObject({
            clips: [
                { id: 'c1', endBeat: 3.5, fadeOutBeats: 0.5 },
                { id: 'c2', startBeat: 3.5, fadeInBeats: 0.5 },
            ],
        });
    });

    it('rejects compensation after either clip diverges from the expected snapshot', () => {
        const result = handleRestoreCrossfadeClips.execute({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'c1',
                clipBId: 'c2',
                expected: { clipAEndBeat: 4.5, clipAFadeOutBeats: 1, clipBStartBeat: 3.5, clipBFadeInBeats: 1 },
                replacement: { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });
});
