import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceInPlace } from '../bounceInPlace';

const mocks = vi.hoisted(() => ({
    bounceInPlace: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceInPlace', () => ({
    bounceInPlace: mocks.bounceInPlace,
}));

describe('handleBounceInPlace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceInPlace with the provided payload', async () => {
        mocks.bounceInPlace.mockResolvedValue(true);
        const result = await handleBounceInPlace.execute({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });

        expect(mocks.bounceInPlace).toHaveBeenCalledWith('t1');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when in-place bounce is rejected', async () => {
        mocks.bounceInPlace.mockResolvedValue(false);

        const result = await handleBounceInPlace.execute({
            type: 'bounceInPlace',
            payload: { trackId: 'vca-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleBounceInPlace.describe({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Bounce in place');
    });

    // Undo for a bounce is filed by `bounceTrack` itself, as a callback entry carrying the
    // before/after track snapshots. Marking the handler undoable as well would put a second
    // entry on the stack for one command, and that one has no inverse action to run.
    it('is not command-undoable, because the use case files its own undo entry', () => {
        expect(handleBounceInPlace.undoable).toBe(false);
    });
});
