import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => ({
    preferencesStoreValue: { value: { trackHeight: 'normal' } },
    preferencesStoreSet: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value() { return mocks.preferencesStoreValue.value; },
        set: mocks.preferencesStoreSet,
    }
}));

describe('setTrackHeight', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates trackHeight in preferencesStore', () => {
        mocks.preferencesStoreValue.value = { trackHeight: 'normal' } as any;
        
        setTrackHeight('compact');

        expect(mocks.preferencesStoreSet).toHaveBeenCalledWith({
            trackHeight: 'compact',
        });
    });
});
