import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../dismissGhostClip';

type GhostClip = { id: string };
type TrackLike = { id: string; clips: { id: string }[] };
type State = { ghostClips?: GhostClip[]; tracks: TrackLike[] };

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as State | null },
    storeSet: vi.fn(),
    updateTrack: vi.fn(),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../../updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('dismissGhostClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('removes the ghost clip from the dedicated ghost list when present', () => {
        mocks.storeValue.value = {
            ghostClips: [{ id: 'g1' }, { id: 'g2' }],
            tracks: [],
        };

        subject.dismissGhostClip('g1');

        expect(mocks.storeSet).toHaveBeenCalledTimes(1);
        const next = mocks.storeSet.mock.calls[0]?.[0] as State;
        expect(next.ghostClips).toEqual([{ id: 'g2' }]);
    });

    it('falls back to removing a legacy ghost-flag clip from a track when no ghost entry exists', () => {
        mocks.storeValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'legacy' }] }],
        };

        subject.dismissGhostClip('legacy');

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        const [trackId, updater] = mocks.updateTrack.mock.calls[0] ?? [];
        expect(trackId).toBe('t1');
        const result = updater({ id: 't1', clips: [{ id: 'legacy' }, { id: 'keep' }] });
        expect(result.clips).toEqual([{ id: 'keep' }]);
    });

    it('skips tracks that do not contain the legacy ghost clip id', () => {
        mocks.storeValue.value = {
            tracks: [
                { id: 't1', clips: [{ id: 'other' }] },
                { id: 't2', clips: [{ id: 'legacy' }] },
            ],
        };

        subject.dismissGhostClip('legacy');

        // Only the track owning the clip is rewritten.
        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.updateTrack.mock.calls[0]?.[0]).toBe('t2');
    });

    it('does nothing when the store has not loaded', () => {
        mocks.storeValue.value = null;

        subject.dismissGhostClip('g1');

        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });
});
