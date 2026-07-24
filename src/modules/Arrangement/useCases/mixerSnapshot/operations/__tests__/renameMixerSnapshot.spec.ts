import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../renameMixerSnapshot';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as { snapshots: { id: string; name: string }[] } | null },
    storeSet: vi.fn(),
}));

vi.mock('../../../../stores/mixerSnapshotStore', () => ({
    mixerSnapshotStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

describe('renameMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('renames only the targeted snapshot and leaves siblings untouched', () => {
        mocks.storeValue.value = {
            snapshots: [
                { id: 's1', name: 'Verse' },
                { id: 's2', name: 'Chorus' },
            ],
        };

        subject.renameMixerSnapshot('s2', 'Drop');

        expect(mocks.storeSet).toHaveBeenCalledTimes(1);
        const next = mocks.storeSet.mock.calls[0]?.[0] as {
            snapshots: { id: string; name: string }[];
        };
        expect(next.snapshots).toEqual([
            { id: 's1', name: 'Verse' },
            { id: 's2', name: 'Drop' },
        ]);
    });

    it('writes nothing when the snapshot store has not loaded', () => {
        mocks.storeValue.value = null;

        subject.renameMixerSnapshot('s1', 'Drop');

        expect(mocks.storeSet).not.toHaveBeenCalled();
    });
});
