import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setScratchPadSectionColor } from '../setScratchPadSectionColor';

type MockSection = { id: string; color: string };
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

describe('setScratchPadSectionColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates the section color and leaves other sections untouched', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'other', color: '#000' },
                { id: 's1', color: '#aaa' },
            ],
        };

        setScratchPadSectionColor('s1', '#fff');

        expect(mocks.scratchPadSet).toHaveBeenCalledWith({
            sections: [
                { id: 'other', color: '#000' },
                { id: 's1', color: '#fff' },
            ],
        });
    });

    it('is a no-op when the scratch pad store has not loaded', () => {
        mocks.scratchPadValue.value = null;

        setScratchPadSectionColor('s1', '#fff');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });
});
