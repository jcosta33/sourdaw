import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => {
    const preferencesStoreValue: { value: { trackHeight: string } | null } = { value: { trackHeight: 'normal' } };
    return {
        preferencesStoreValue,
        preferencesStoreSet: vi.fn<(...args: unknown[]) => void>(),
    };
});

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferencesStoreValue.value;
        },
        trySet: mocks.preferencesStoreSet,
    },
}));

describe('setTrackHeight', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates trackHeight in preferencesStore', () => {
        mocks.preferencesStoreValue.value = { trackHeight: 'normal' };

        setTrackHeight('compact');

        expect(mocks.preferencesStoreSet).toHaveBeenCalledWith({
            trackHeight: 'compact',
        });
    });

    it('does nothing when preferencesStore has no value yet', () => {
        mocks.preferencesStoreValue.value = null;

        setTrackHeight('large');

        expect(mocks.preferencesStoreSet).not.toHaveBeenCalled();
    });
});
