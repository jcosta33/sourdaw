import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resizeSection } from '../resizeSection';

const mocks = vi.hoisted(() => {
    type MockSection = { id: string; startBeat: number; endBeat: number };
    return {
        markerStoreValue: { value: { sections: [] as MockSection[] } },
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
});
