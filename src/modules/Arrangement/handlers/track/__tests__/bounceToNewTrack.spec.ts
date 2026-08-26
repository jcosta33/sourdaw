import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceToNewTrack } from '../bounceToNewTrack';

const mocks = vi.hoisted(() => ({
    bounceToNewTrack:
        vi.fn<(trackId: string, options?: { deferUndoEntry?: (file: () => void) => void }) => Promise<boolean>>(),
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceToNewTrack', () => ({
    bounceToNewTrack: mocks.bounceToNewTrack,
}));

describe('handleBounceToNewTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceToNewTrack with the provided payload and defers the undo filing to the post-commit hooks', async () => {
        // The use case hands the entry filing over rather than filing during
        // execute — what runs below is the only path from this command to history.
        const fileUndoEntry = vi.fn();
        mocks.bounceToNewTrack.mockImplementation(async (_trackId, options) => {
            options?.deferUndoEntry?.(fileUndoEntry);
            return true;
        });

        const result = await handleBounceToNewTrack.execute({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.bounceToNewTrack).toHaveBeenCalledWith('t1', { deferUndoEntry: expect.any(Function) });
        if (!result.afterCommit || !result.afterAmbiguousCommit) {
            throw new Error('expected the written result to carry the post-commit hooks');
        }

        // The phantom check: execute handed the filing over but must not have
        // run it — an entry filed now would survive a commit-time abort that
        // rolls the bounce back.
        expect(fileUndoEntry).not.toHaveBeenCalled();

        // Each settlement path files the entry exactly once, only when it runs.
        result.afterCommit();
        expect(fileUndoEntry).toHaveBeenCalledTimes(1);
        result.afterAmbiguousCommit();
        expect(fileUndoEntry).toHaveBeenCalledTimes(2);
    });

    it('reports no-write when new-track bounce is rejected', async () => {
        mocks.bounceToNewTrack.mockResolvedValue(false);

        const result = await handleBounceToNewTrack.execute({
            type: 'bounceToNewTrack',
            payload: { trackId: 'vca-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleBounceToNewTrack.describe({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Bounce to new track');
    });

    // Undo for a bounce is a callback entry built by `bounceTrack` carrying the before/
    // after track snapshots, filed from this handler's post-commit hooks so it exists only
    // once the write committed. Marking the handler undoable as well would put a second
    // entry on the stack for one command, and that one has no inverse action to run.
    it('is not command-undoable, because the use case files its own undo entry', () => {
        expect(handleBounceToNewTrack.undoable).toBe(false);
    });
});
