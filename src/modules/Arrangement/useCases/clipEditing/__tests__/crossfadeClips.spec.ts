import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as mapAllTracksRepo from '../../../repositories/track/mapAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => (typeof trackStateRepo)['getTrackState'] extends () => infer R ? R : never>(),
    mapAllTracks: vi.fn<(typeof mapAllTracksRepo)['mapAllTracks']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));

import { crossfadeClips } from '../crossfadeClips';

const make_clip = (id: string, start: number, end: number) => ({
    id,
    startBeat: start,
    endBeat: end,
    name: id,
    type: 'audio',
});

describe('crossfadeClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        crossfadeClips('a', 'b');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('does nothing when clips not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }], selectedTrackId: 't1' } as never);
        crossfadeClips('missing-a', 'missing-b');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('extends clip A endBeat and clip B startBeat', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [make_clip('a', 0, 4), make_clip('b', 4, 8)],
                },
            ],
            selectedTrackId: 't1',
        } as never);
        mocks.mapAllTracks.mockImplementation((fn: (t: { clips: unknown[] }) => unknown) => fn({ clips: [] }) as never);

        crossfadeClips('a', 'b', 1.0);

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { clips: unknown[] }) => unknown;

        const input_track = { id: 't1', clips: [make_clip('a', 0, 4), make_clip('b', 4, 8)] };
        const result = mapper(input_track as never) as {
            clips: { id: string; endBeat: number; startBeat: number; fadeOutBeats?: number; fadeInBeats?: number }[];
        };

        const clip_a = result.clips.find((c) => c.id === 'a')!;
        const clip_b = result.clips.find((c) => c.id === 'b')!;
        expect(clip_a.endBeat).toBe(4.5);
        expect(clip_b.startBeat).toBe(3.5);
        expect(clip_a.fadeOutBeats).toBe(1);
        expect(clip_b.fadeInBeats).toBe(1);
    });

    it('uses default duration of 0.5 beats', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('a', 0, 4), make_clip('b', 4, 8)] }],
            selectedTrackId: 't1',
        } as never);
        mocks.mapAllTracks.mockImplementation((fn: (t: { clips: unknown[] }) => unknown) => fn({ clips: [] }) as never);

        crossfadeClips('a', 'b');

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { clips: unknown[] }) => unknown;
        const input_track = { id: 't1', clips: [make_clip('a', 0, 4), make_clip('b', 4, 8)] };
        const result = mapper(input_track as never) as { clips: { id: string; endBeat: number; startBeat: number }[] };
        const clip_a = result.clips.find((c) => c.id === 'a')!;
        expect(clip_a.endBeat).toBe(4.25);
    });
});
