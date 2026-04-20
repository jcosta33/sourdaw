import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveSection } from '../moveSection';

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

describe('moveSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('moves section and maintains duration', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 's1', startBeat: 0, endBeat: 16 }], // Duration 16
        };

        moveSection('s1', 10.2);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', startBeat: 10, endBeat: 26 }],
        });
    });
});
