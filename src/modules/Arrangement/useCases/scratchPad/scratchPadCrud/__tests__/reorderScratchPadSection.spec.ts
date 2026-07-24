import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderScratchPadSection } from '../reorderScratchPadSection';

type MockSection = { id: string; order: number; startBeat: number; endBeat: number };
type ScratchPadState = { sections: MockSection[] };
type ScratchPadHolder = { value: ScratchPadState | null };

const mocks = vi.hoisted(() => {
    const holder: ScratchPadHolder = { value: { sections: [] } };
    return {
        scratchPadValue: holder,
        scratchPadSet: vi.fn<(state: ScratchPadState) => void>(),
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

describe('reorderScratchPadSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('moves a section left and re-packs beat positions by duration', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'a', order: 0, startBeat: 0, endBeat: 4 },
                { id: 'b', order: 1, startBeat: 4, endBeat: 12 },
                { id: 'c', order: 2, startBeat: 12, endBeat: 16 },
            ],
        };

        reorderScratchPadSection('c', 'left');

        const setCall = mocks.scratchPadSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected scratchPadStore.set to be called');
        }
        // c moves before b; orders renumber 0,1,2 and beats re-pack by duration
        expect(setCall[0].sections).toEqual([
            { id: 'a', order: 0, startBeat: 0, endBeat: 4 },
            { id: 'c', order: 1, startBeat: 4, endBeat: 8 },
            { id: 'b', order: 2, startBeat: 8, endBeat: 16 },
        ]);
    });

    it('moves a section right', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'a', order: 0, startBeat: 0, endBeat: 4 },
                { id: 'b', order: 1, startBeat: 4, endBeat: 8 },
            ],
        };

        reorderScratchPadSection('a', 'right');

        const setCall = mocks.scratchPadSet.mock.calls[0]!;
        expect(setCall[0].sections.map((s: MockSection) => s.id)).toEqual(['b', 'a']);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.scratchPadValue.value = null;

        reorderScratchPadSection('a', 'left');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });

    it('is a no-op when the section id is unknown', () => {
        mocks.scratchPadValue.value = {
            sections: [{ id: 'a', order: 0, startBeat: 0, endBeat: 4 }],
        };

        reorderScratchPadSection('missing', 'left');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });

    it('is a no-op when moving the first section left (boundary)', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'a', order: 0, startBeat: 0, endBeat: 4 },
                { id: 'b', order: 1, startBeat: 4, endBeat: 8 },
            ],
        };

        reorderScratchPadSection('a', 'left');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });

    it('is a no-op when moving the last section right (boundary)', () => {
        mocks.scratchPadValue.value = {
            sections: [
                { id: 'a', order: 0, startBeat: 0, endBeat: 4 },
                { id: 'b', order: 1, startBeat: 4, endBeat: 8 },
            ],
        };

        reorderScratchPadSection('b', 'right');

        expect(mocks.scratchPadSet).not.toHaveBeenCalled();
    });
});
