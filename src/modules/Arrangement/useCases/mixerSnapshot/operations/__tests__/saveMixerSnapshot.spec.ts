import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MixerSnapshot } from '../../../../models/MixerSnapshotTypes';
import { saveMixerSnapshot } from '../saveMixerSnapshot';

type MockTrack = { id: string; gain: number; pan: number; muted: boolean; soloed: boolean };
type MockTrackState = { tracks: MockTrack[]; selectedTrackId: string | null };
type TrackHolder = { value: MockTrackState | null };
type SnapshotHolder = { value: { snapshots: MixerSnapshot[] } | null };

const mocks = vi.hoisted(() => {
    const trackHolder: TrackHolder = { value: null };
    const snapshotHolder: SnapshotHolder = { value: { snapshots: [] } };
    return {
        trackHolder,
        snapshotHolder,
        mixerSnapshotStoreSet: vi.fn<(state: { snapshots: MixerSnapshot[] }) => void>(),
    };
});

vi.mock('../../../../repositories/track/getTrackState', () => ({
    getTrackState: () => mocks.trackHolder.value,
}));

vi.mock('../../../../stores/mixerSnapshotStore', () => ({
    mixerSnapshotStore: {
        get value() {
            return mocks.snapshotHolder.value;
        },
        set: mocks.mixerSnapshotStoreSet,
    },
}));

describe('saveMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackHolder.value = null;
        mocks.snapshotHolder.value = { snapshots: [] };
    });

    it('returns null when there is no track state (cleared/absent project)', () => {
        expect(saveMixerSnapshot('Verse')).toBeNull();
        expect(mocks.mixerSnapshotStoreSet).not.toHaveBeenCalled();
    });

    it('captures the current per-track mix into a new snapshot and appends it to the store', () => {
        mocks.trackHolder.value = {
            tracks: [
                { id: 't1', gain: 0.5, pan: 0, muted: false, soloed: false },
                { id: 't2', gain: 0.8, pan: -0.25, muted: true, soloed: false },
            ],
            selectedTrackId: null,
        };
        mocks.snapshotHolder.value = {
            snapshots: [{ id: 'snap-old', name: 'Old', createdAt: 0, channels: [] }],
        };

        const snapshot = saveMixerSnapshot('Chorus');

        expect(snapshot).toMatchObject({
            name: 'Chorus',
            channels: [
                { trackId: 't1', gain: 0.5, pan: 0, muted: false, soloed: false },
                { trackId: 't2', gain: 0.8, pan: -0.25, muted: true, soloed: false },
            ],
        });
        expect(mocks.mixerSnapshotStoreSet).toHaveBeenCalledTimes(1);
        const next = mocks.mixerSnapshotStoreSet.mock.calls[0]![0];
        expect(next.snapshots).toHaveLength(2);
        expect(next.snapshots[1]).toBe(snapshot);
    });

    it('returns the snapshot without persisting when the snapshot store holds no state', () => {
        mocks.trackHolder.value = {
            tracks: [{ id: 't1', gain: 1, pan: 0, muted: false, soloed: false }],
            selectedTrackId: null,
        };
        mocks.snapshotHolder.value = null;

        const snapshot = saveMixerSnapshot('Solo');

        expect(snapshot).toMatchObject({ name: 'Solo' });
        // No prior state to append into — the snapshot is returned as-is.
        expect(mocks.mixerSnapshotStoreSet).not.toHaveBeenCalled();
    });
});
