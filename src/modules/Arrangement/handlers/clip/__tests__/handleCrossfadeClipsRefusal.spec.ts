import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { handleCrossfadeClips } from '../handleCrossfadeClips';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as mapAllTracksRepo from '../../../repositories/track/mapAllTracks';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
import type * as trackStoreStateModule from '../../../useCases/getTrackStoreState';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    getTrackStoreState: vi.fn<(typeof trackStoreStateModule)['getTrackStoreState']>(),
    mapAllTracks: vi.fn<(typeof mapAllTracksRepo)['mapAllTracks']>(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

const action = {
    type: 'crossfadeClips',
    payload: { clipAId: 'a', clipBId: 'b', durationBeats: 1 },
} as const;

function clip(id: string, startBeat: number, endBeat: number, overrides: Partial<Clip> = {}): Clip {
    return ClipDummy.create({ id, startBeat, endBeat, fadeInBeats: 0, fadeOutBeats: 0, ...overrides });
}

function loadTracks(tracks: Track[]): void {
    const state = { tracks, selectedTrackId: tracks[0]?.id ?? null };
    mocks.getTrackState.mockReturnValue(state);
    mocks.getTrackStoreState.mockReturnValue(state);
    mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }) => {
        const owner = tracks.find((track) => track.clips.some((candidate) => candidate.id === clipId));
        return owner ? { status: 'eligible', trackId: owner.id, clipId } : { status: 'missing' };
    });
}

const refusedPairs: { name: string; tracks: () => Track[] }[] = [
    {
        name: 'MIDI clip A and audio clip B',
        tracks: () => [
            TrackDummy.create({
                id: 't1',
                clips: [clip('a', 0, 4, { type: 'midi' }), clip('b', 4, 8, { audioOffsetBeats: 2 })],
            }),
        ],
    },
    {
        name: 'audio clip A and MIDI clip B',
        tracks: () => [
            TrackDummy.create({
                id: 't1',
                clips: [clip('a', 0, 4), clip('b', 4, 8, { type: 'midi', midiOffsetBeats: 2 })],
            }),
        ],
    },
    {
        name: 'two MIDI clips',
        tracks: () => [
            TrackDummy.create({
                id: 't1',
                clips: [clip('a', 0, 4, { type: 'midi' }), clip('b', 4, 8, { type: 'midi', midiOffsetBeats: 2 })],
            }),
        ],
    },
    {
        name: 'audio clips on different tracks',
        tracks: () => [
            TrackDummy.create({ id: 't1', clips: [clip('a', 0, 4)] }),
            TrackDummy.create({ id: 't2', clips: [clip('b', 4, 8, { audioOffsetBeats: 2 })] }),
        ],
    },
];

describe('handleCrossfadeClips refusal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(refusedPairs)('refuses $name: no write and no undo inverse', ({ tracks }) => {
        loadTracks(tracks());

        expect(handleCrossfadeClips.execute(action)).toEqual({ status: 'no-write' });
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();

        const description = handleCrossfadeClips.describe(action);
        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
    });

    it('still crossfades two audio clips on one track and describes the exact inverse and redo', () => {
        const track = TrackDummy.create({
            id: 't1',
            clips: [clip('a', 0, 4), clip('b', 4, 8, { audioOffsetBeats: 2 })],
        });
        loadTracks([track]);

        expect(handleCrossfadeClips.execute(action)).toEqual({ status: 'written' });
        const mapper = mocks.mapAllTracks.mock.calls[0]?.[0];
        if (!mapper) {
            throw new Error('Expected the crossfade to write through mapAllTracks');
        }
        expect(mapper(track).clips).toMatchObject([
            { id: 'a', endBeat: 4.5, fadeOutBeats: 1 },
            { id: 'b', startBeat: 3.5, fadeInBeats: 1, audioOffsetBeats: 1.5 },
        ]);

        const forward = { clipAEndBeat: 4.5, clipAFadeOutBeats: 1, clipBStartBeat: 3.5, clipBFadeInBeats: 1 };
        const initial = { clipAEndBeat: 4, clipAFadeOutBeats: 0, clipBStartBeat: 4, clipBFadeInBeats: 0 };
        const description = handleCrossfadeClips.describe(action);
        expect(description.inverseAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'a',
                clipBId: 'b',
                expected: { ...forward, clipBAudioOffsetBeats: 1.5 },
                replacement: { ...initial, clipBAudioOffsetBeats: 2 },
            },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreCrossfadeClips',
            payload: {
                clipAId: 'a',
                clipBId: 'b',
                expected: { ...initial, clipBAudioOffsetBeats: 2 },
                replacement: { ...forward, clipBAudioOffsetBeats: 1.5 },
            },
        });
    });
});
