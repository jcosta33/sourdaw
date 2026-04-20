import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeSection } from '../removeSection';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: { sections: [] } },
    markerStoreSet: vi.fn(),
}));

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('removeSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes the specified section', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 's1' }, { id: 's2' }],
        };

        removeSection('s1');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's2' }],
        });
    });
});
