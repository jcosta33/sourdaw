import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveSection } from '../moveSection';

type MockSection = { id: string; startBeat: number; endBeat: number };
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

    it('leaves other sections untouched and still moves the targeted one', () => {
        mocks.markerStoreValue.value = {
            sections: [
                { id: 'other', startBeat: 0, endBeat: 4 },
                { id: 's1', startBeat: 0, endBeat: 16 },
            ],
        };

        moveSection('s1', 10);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [
                { id: 'other', startBeat: 0, endBeat: 4 },
                { id: 's1', startBeat: 10, endBeat: 26 },
            ],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        moveSection('s1', 10);

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
