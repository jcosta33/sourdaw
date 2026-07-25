import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScratchPadSection } from '../../../../models/ScratchPadSection';
import { addScratchPadSection } from '../addScratchPadSection';

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

describe('addScratchPadSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sectionHolder.value = { sections: [] };
    });

    it('appends a section whose order is the next index in the pad', () => {
        mocks.sectionHolder.value = {
            sections: [{ id: 'existing', startBeat: 0, endBeat: 4, name: 'A', color: '#fff', order: 0 }],
        };

        addScratchPadSection(4, 8, 'B', '#000');

        const setCall = mocks.scratchPadSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected scratchPadStore.set to be called');
        }
        const added = setCall[0].sections[1];
        if (!added) {
            throw new Error('expected appended section');
        }
        expect(added).toMatchObject({ startBeat: 4, endBeat: 8, name: 'B', color: '#000', order: 1 });
        // New id is generated, not hardcoded.
        expect(added.id).toMatch(/^scratch-/);
    });

    it('is a no-op when the scratch pad store has not loaded', () => {
        mocks.sectionHolder.value = null;

        addScratchPadSection(0, 4, 'A', '#fff');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });
});
