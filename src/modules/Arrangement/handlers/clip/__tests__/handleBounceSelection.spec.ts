import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceSelection } from '../handleBounceSelection';

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

describe('handleBounceSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
    });

    it('executes bounceSelection with the provided payload', async () => {
        mocks.bounceSelection.mockResolvedValue(true);
        const result = await handleBounceSelection.execute({
            type: 'bounceSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });

        expect(mocks.bounceSelection).toHaveBeenCalledWith('t1', 0, 4);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when selection bounce is rejected', async () => {
        mocks.bounceSelection.mockResolvedValue(false);

        const result = await handleBounceSelection.execute({
            type: 'bounceSelection',
            payload: { trackId: 'vca-1', startBeat: 0, endBeat: 4 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('rejects an ineligible destination before bounce rendering', async () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const result = await handleBounceSelection.execute({
            type: 'bounceSelection',
            payload: { trackId: 'vca-1', startBeat: 0, endBeat: 4 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.bounceSelection).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleBounceSelection.describe({
            type: 'bounceSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
        expect(desc.label).toBe('Bounce selection to audio');
    });

    // Undo for a selection bounce is filed by `bounceSelection` itself, as a callback entry.
    // Marking the handler undoable as well would put a second entry on the stack for one
    // command, and that one has no inverse action to run.
    it('is not command-undoable, because the use case files its own undo entry', () => {
        expect(handleBounceSelection.undoable).toBe(false);
    });
});
