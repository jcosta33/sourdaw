import { describe, it, expect, beforeEach, vi } from 'vitest';

import { addScratchPadSection } from '../scratchPadCrud/addScratchPadSection';
import { clearScratchPad } from '../scratchPadCrud/clearScratchPad';

import type { ScratchPadStoreState } from '../../../stores/scratchPadStore';

const mockSet = vi.fn<(...args: unknown[]) => void>();
let mockValue: ScratchPadStoreState | null = null;

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mockValue;
        },
        set: (value: unknown) => mockSet(value),
    },
}));

describe('scratchPadCrud', () => {
    beforeEach(() => {
        mockSet.mockReset();
    });

    it('addScratchPadSection appends a section', () => {
        mockValue = { sections: [] } as unknown as ScratchPadStoreState;
        addScratchPadSection(0, 4, 'A', '#fff');
        expect(mockSet).toHaveBeenCalledTimes(1);
        const next = mockSet.mock.calls[0]![0] as ScratchPadStoreState;
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
    });

    it('clearScratchPad empties sections', () => {
        mockValue = { sections: [{ id: 'x' }] } as unknown as ScratchPadStoreState;
        clearScratchPad();
        expect(mockSet).toHaveBeenCalledWith({ sections: [] });
    });
});
