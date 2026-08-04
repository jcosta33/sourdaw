import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeSection } from '../removeSection';

type MockSection = { id: string };
type MarkerHolder = { value: { sections: MockSection[] } | null };

const mocks = vi.hoisted(() => {
    const holder: MarkerHolder = { value: { sections: [] } };
    return {
        markerStoreValue: holder,
        markerStoreSet: vi.fn(),
    };
});

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

        const changed = removeSection('s1');

        expect(changed).toBe(true);
        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's2' }],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        const changed = removeSection('s1');

        expect(changed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('writes nothing and reports false when the section does not exist', () => {
        mocks.markerStoreValue.value = { sections: [{ id: 's2' }] };

        const changed = removeSection('missing');

        expect(changed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
