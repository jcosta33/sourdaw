import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renameScratchPadSection } from '../renameScratchPadSection';

type MockSection = { id: string; name: string };
type ScratchPadHolder = { value: { sections: MockSection[] } | null };

const mocks = vi.hoisted(() => {
    const holder: ScratchPadHolder = { value: { sections: [] } };
    return {
        scratchPadValue: holder,
        scratchPadSet: vi.fn(),
    };
});

vi.mock('../../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mocks.scratchPadValue.value;
        },
        set: mocks.scratchPadSet,
    },
}));

describe('renameScratchPadSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates the section name and leaves other sections untouched', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'other', name: 'Keep' },
                { id: 's1', name: 'Verse' },
            ],
        };

        renameScratchPadSection('s1', 'Chorus');

        expect(mocks.scratchPadSet).toHaveBeenCalledWith({
            sections: [
                { id: 'other', name: 'Keep' },
                { id: 's1', name: 'Chorus' },
            ],
        });
    });

    it('is a no-op when the scratch pad store has not loaded', () => {
        mocks.scratchPadValue.value = null;

        renameScratchPadSection('s1', 'Chorus');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });
});
