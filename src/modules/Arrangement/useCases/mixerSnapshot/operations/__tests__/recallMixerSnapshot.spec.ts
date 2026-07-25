import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MixerSnapshot } from '../../../../models/MixerSnapshotTypes';
import { recallMixerSnapshot } from '../recallMixerSnapshot';

type MockTrack = { id: string; gain: number; pan: number; muted: boolean; soloed: boolean };
type MockTrackState = { tracks: MockTrack[]; selectedTrackId: string | null };
type TrackHolder = { value: MockTrackState | null };
type SnapshotHolder = { value: { snapshots: MixerSnapshot[] } | null };

const mocks = vi.hoisted(() => {
    const trackHolder: TrackHolder = { value: { tracks: [], selectedTrackId: null } };
    const snapshotHolder: SnapshotHolder = { value: { snapshots: [] } };
    return {
        trackHolder,
        snapshotHolder,
        setTrackState: vi.fn<(state: MockTrackState) => void>(),
    };
});

vi.mock('../../../../repositories/track/getTrackState', () => ({
    getTrackState: () => mocks.trackHolder.value,
}));

vi.mock('../../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('../../../../stores/mixerSnapshotStore', () => ({
    mixerSnapshotStore: {
        get value() {
            return mocks.snapshotHolder.value;
        },
    },
}));

describe('recallMixerSnapshot', () => {
    beforeEach(() => vi.clearAllMocks());

    it('applies the snapshot channels to matching tracks and returns the previous mix', () => {
        mocks.trackHolder.value = {
            tracks: [
                { id: 't1', gain: 0.5, pan: 0, muted: false, soloed: false },
                { id: 't2', gain: 0.8, pan: -0.25, muted: true, soloed: false },
            ],
            selectedTrackId: null,
        };
        mocks.snapshotHolder.value = {
            snapshots: [
                {
                    id: 'snap-1',
                    name: 'Chorus',
                    createdAt: 0,
                    channels: [{ trackId: 't1', gain: 1.0, pan: 0.5, muted: true, soloed: false }],
                },
            ],
        };

        const previous = recallMixerSnapshot('snap-1');

        // The pre-recall mix is returned so callers can build an undo entry.
        expect(previous).toEqual([
            { trackId: 't1', gain: 0.5, pan: 0, muted: false, soloed: false },
            { trackId: 't2', gain: 0.8, pan: -0.25, muted: true, soloed: false },
        ]);

        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to be called');
        }
        const tracks = setCall[0].tracks;
        // t1 takes the snapshot values; t2 (absent from snapshot) is untouched.
        expect(tracks[0]).toEqual({ id: 't1', gain: 1.0, pan: 0.5, muted: true, soloed: false });
        expect(tracks[1]).toEqual({ id: 't2', gain: 0.8, pan: -0.25, muted: true, soloed: false });
    });

    it('returns null when the snapshot id is unknown', () => {
        mocks.snapshotHolder.value = { snapshots: [] };
        mocks.trackHolder.value = { tracks: [], selectedTrackId: null };

        expect(recallMixerSnapshot('missing')).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when the track store has not loaded', () => {
        mocks.snapshotHolder.value = {
            snapshots: [{ id: 'snap-1', name: 'S', createdAt: 0, channels: [] }],
        };
        mocks.trackHolder.value = null;

        expect(recallMixerSnapshot('snap-1')).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when the snapshot store itself has not loaded', () => {
        // mixerSnapshotStore.value is null: the snapshots list falls back to []
        // and the lookup misses, so nothing is recalled.
        mocks.snapshotHolder.value = null;
        mocks.trackHolder.value = { tracks: [], selectedTrackId: null };

        expect(recallMixerSnapshot('snap-1')).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
