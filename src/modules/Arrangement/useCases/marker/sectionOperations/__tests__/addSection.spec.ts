import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addSection } from '../addSection';

import type { MarkerStoreState } from '../../../../stores/markerStore';

const mocks = vi.hoisted(() => {
    const markerStoreValue: { value: { sections: unknown[] } | null } = { value: { sections: [] } };
    return {
        markerStoreValue,
        markerStoreSet: vi.fn<(...args: unknown[]) => void>(),
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

describe('addSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.markerStoreValue.value = { sections: [] };
    });

    it('adds a section to the store', () => {
        const changed = addSection(0, 32, 'Intro', 'section-intro', '#123456');

        expect(changed).toBe(true);
        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0]![0] as MarkerStoreState;
        expect(newState.sections).toHaveLength(1);
        expect(newState.sections[0]).toMatchObject({
            startBeat: 0,
            endBeat: 32,
            name: 'Intro',
            id: 'section-intro',
            color: '#123456',
        });
    });

    it('is a no-op when the marker store holds no state (cleared/absent project)', () => {
        mocks.markerStoreValue.value = null;

        const changed = addSection(0, 32, 'Intro');

        expect(changed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
