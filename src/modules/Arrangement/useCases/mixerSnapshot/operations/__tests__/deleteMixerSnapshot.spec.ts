import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MixerSnapshot } from '../../../../models/MixerSnapshotTypes';
import { deleteMixerSnapshot } from '../deleteMixerSnapshot';

type SnapshotHolder = { value: { snapshots: MixerSnapshot[] } | null };

const mocks = vi.hoisted(() => {
    const holder: SnapshotHolder = { value: { snapshots: [] } };
    return {
        snapshotHolder: holder,
        mixerSnapshotStoreSet: vi.fn<(state: { snapshots: MixerSnapshot[] }) => void>(),
    };
});

vi.mock('../../../../stores/mixerSnapshotStore', () => ({
    mixerSnapshotStore: {
        get value() {
            return mocks.snapshotHolder.value;
        },
        set: mocks.mixerSnapshotStoreSet,
    },
}));

describe('deleteMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.snapshotHolder.value = { snapshots: [] };
    });

    it('removes the matching snapshot and keeps the others', () => {
        mocks.snapshotHolder.value = {
            snapshots: [
                { id: 'snap-1', name: 'Verse', createdAt: 0, channels: [] },
                { id: 'snap-2', name: 'Chorus', createdAt: 1, channels: [] },
            ],
        };

        deleteMixerSnapshot('snap-1');

        const setCall = mocks.mixerSnapshotStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected mixerSnapshotStore.set to be called');
        }
        expect(setCall[0].snapshots.map((s) => s.id)).toEqual(['snap-2']);
    });

    it('is a no-op when the snapshot store has not loaded', () => {
        mocks.snapshotHolder.value = null;

        deleteMixerSnapshot('snap-1');

        expect(mocks.mixerSnapshotStoreSet).not.toHaveBeenCalled();
    });
});
