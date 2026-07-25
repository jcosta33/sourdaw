import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScratchPadSection } from '../../../../models/ScratchPadSection';
import { removeScratchPadSection } from '../removeScratchPadSection';

type SectionHolder = { value: { sections: ScratchPadSection[] } | null };

const mocks = vi.hoisted(() => {
    const holder: SectionHolder = { value: { sections: [] } };
    return {
        sectionHolder: holder,
        scratchPadSet: vi.fn<(state: { sections: ScratchPadSection[] }) => void>(),
    };
});

vi.mock('../../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mocks.sectionHolder.value;
        },
        set: mocks.scratchPadSet,
    },
}));

describe('removeScratchPadSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sectionHolder.value = { sections: [] };
    });

    it('removes the section and re-packs the order of the remaining ones', () => {
        mocks.sectionHolder.value = {
            sections: [
                { id: 'a', startBeat: 0, endBeat: 4, name: 'A', color: '#fff', order: 0 },
                { id: 'b', startBeat: 4, endBeat: 8, name: 'B', color: '#000', order: 1 },
                { id: 'c', startBeat: 8, endBeat: 12, name: 'C', color: '#111', order: 2 },
            ],
        };

        removeScratchPadSection('b');

        const setCall = mocks.scratchPadSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected scratchPadStore.set to be called');
        }
        // b is dropped; surviving sections are re-numbered 0,1 in place.
        expect(setCall[0].sections.map((s) => ({ id: s.id, order: s.order }))).toEqual([
            { id: 'a', order: 0 },
            { id: 'c', order: 1 },
        ]);
    });

    it('is a no-op when the scratch pad store has not loaded', () => {
        mocks.sectionHolder.value = null;

        removeScratchPadSection('a');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });
});
