import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceToNewTrack } from '../bounceToNewTrack';

const mocks = vi.hoisted(() => ({
    bounceToNewTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceToNewTrack', () => ({
    bounceToNewTrack: mocks.bounceToNewTrack,
}));

describe('handleBounceToNewTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceToNewTrack with the provided payload', async () => {
        mocks.bounceToNewTrack.mockResolvedValue(true);
        const result = await handleBounceToNewTrack.execute({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.bounceToNewTrack).toHaveBeenCalledWith('t1');
        expect(result).toEqual({ status: 'written' });
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

    // Undo for a bounce is filed by `bounceTrack` itself, as a callback entry carrying the
    // before/after track snapshots. Marking the handler undoable as well would put a second
    // entry on the stack for one command, and that one has no inverse action to run.
    it('is not command-undoable, because the use case files its own undo entry', () => {
        expect(handleBounceToNewTrack.undoable).toBe(false);
    });
});
