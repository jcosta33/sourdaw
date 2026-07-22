import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleConsolidateSelection } from '../handleConsolidateSelection';

const mocks = vi.hoisted(() => ({
    bounceSelection: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../useCases/freezeBounce/bounceSelection', () => ({
    bounceSelection: mocks.bounceSelection,
}));

describe('handleConsolidateSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
        mocks.bounceSelection.mockResolvedValue(true);
    });

    it('executes bounceSelection with the provided payload', async () => {
        const result = await handleConsolidateSelection.execute({
            type: 'consolidateSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });

        expect(mocks.bounceSelection).toHaveBeenCalledWith('t1', 0, 4);
        expect(result).toEqual({ status: 'written' });
    });

    it('rejects an ineligible destination before bounce rendering and reports no-write', async () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const result = await handleConsolidateSelection.execute({
            type: 'consolidateSelection',
            payload: { trackId: 'vca-1', startBeat: 0, endBeat: 4 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.bounceSelection).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleConsolidateSelection.describe({
            type: 'consolidateSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
        expect(desc.label).toBe('Consolidate selection');
    });

    it('is undoable', () => {
        expect(handleConsolidateSelection.undoable).toBe(true);
    });
});
