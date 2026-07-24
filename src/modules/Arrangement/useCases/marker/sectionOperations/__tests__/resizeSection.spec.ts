import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resizeSection } from '../resizeSection';

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

describe('resizeSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('resizes section boundaries', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 's1', startBeat: 0, endBeat: 16 }],
        };

        resizeSection('s1', 4, 20);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', startBeat: 4, endBeat: 20 }],
        });
    });

    it('enforces minimum duration of 4 beats', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 's1', startBeat: 0, endBeat: 16 }],
        };

        resizeSection('s1', 0, 2);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', startBeat: 0, endBeat: 4 }],
        });
    });

    it('clamps the start beat to 0 and floors the end above the minimum', () => {
        mocks.markerStoreValue.value = {
            sections: [{ id: 's1', startBeat: 0, endBeat: 16 }],
        };

        resizeSection('s1', -3, 1);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', startBeat: 0, endBeat: 4 }],
        });
    });

    it('leaves other sections untouched while resizing the targeted one', () => {
        mocks.markerStoreValue.value = {
            sections: [
                { id: 'other', startBeat: 0, endBeat: 8 },
                { id: 's1', startBeat: 0, endBeat: 16 },
            ],
        };

        resizeSection('s1', 4, 20);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            sections: [
                { id: 'other', startBeat: 0, endBeat: 8 },
                { id: 's1', startBeat: 4, endBeat: 20 },
            ],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        resizeSection('s1', 4, 20);

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
