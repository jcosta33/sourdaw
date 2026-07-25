import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../getMixerSnapshots';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as { snapshots: { id: string; name: string }[] } | null },
}));

vi.mock('../../../../stores/mixerSnapshotStore', () => ({
    mixerSnapshotStore: {
        get value() {
            return mocks.storeValue.value;
        },
    },
}));

describe('getMixerSnapshots', () => {
    beforeEach(() => {
        mocks.storeValue.value = null;
    });

    it('returns the saved mixer snapshots in stored order', () => {
        const snapshots = [
            { id: 's1', name: 'Verse', createdAt: 1, channels: [] },
            { id: 's2', name: 'Chorus', createdAt: 2, channels: [] },
        ];
        mocks.storeValue.value = { snapshots };

        expect(subject.getMixerSnapshots()).toEqual(snapshots);
    });

    it('returns an empty list when no snapshots are saved', () => {
        mocks.storeValue.value = { snapshots: [] };

        expect(subject.getMixerSnapshots()).toEqual([]);
    });

    it('returns an empty list when the store has not loaded', () => {
        mocks.storeValue.value = null;

        expect(subject.getMixerSnapshots()).toEqual([]);
    });
});
