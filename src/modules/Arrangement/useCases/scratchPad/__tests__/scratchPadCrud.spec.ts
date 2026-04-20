import { describe, it, expect, beforeEach, vi } from 'vitest';

import { addScratchPadSection } from '../scratchPadCrud/addScratchPadSection';
import { clearScratchPad } from '../scratchPadCrud/clearScratchPad';

const mockSet = vi.fn();
let mockValue: any = null;

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mockValue;
        },
        set: (v: any) => mockSet(v),
    },
}));

describe('scratchPadCrud', () => {
    beforeEach(() => {
        mockSet.mockReset();
    });

    it('addScratchPadSection appends a section', () => {
        mockValue = { sections: [] };
        addScratchPadSection(0, 4, 'A', '#fff');
        expect(mockSet).toHaveBeenCalledTimes(1);
        const next = mockSet.mock.calls[0]![0] as { sections: { name: string }[] };
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
    });

    it('clearScratchPad empties sections', () => {
        mockValue = { sections: [{ id: 'x' } as never] };
        clearScratchPad();
        expect(mockSet).toHaveBeenCalledWith({ sections: [] });
    });
});
