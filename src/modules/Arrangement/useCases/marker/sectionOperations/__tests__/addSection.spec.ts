import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addSection } from '../addSection';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: { sections: [] } },
    markerStoreSet: vi.fn(),
}));

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() { return mocks.markerStoreValue.value; },
        set: mocks.markerStoreSet,
    }
}));

describe('addSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.markerStoreValue.value = { sections: [] };
    });

    it('adds a section to the store', () => {
        addSection(0, 32, 'Intro');

        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0][0];
        expect(newState.sections).toHaveLength(1);
        expect(newState.sections[0]).toMatchObject({
            startBeat: 0,
            endBeat: 32,
            name: 'Intro',
        });
    });
});
