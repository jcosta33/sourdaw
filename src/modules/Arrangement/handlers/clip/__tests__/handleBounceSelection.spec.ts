import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceSelection } from '../handleBounceSelection';

const mocks = vi.hoisted(() => ({
    bounceSelection: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceSelection', () => ({
    bounceSelection: mocks.bounceSelection,
}));

describe('handleBounceSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('provides a description', () => {
        const desc = handleBounceSelection.describe({
            type: 'bounceSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
        expect(desc.label).toBe('Bounce selection to audio');
    });

    it('is undoable', () => {
        expect(handleBounceSelection.undoable).toBe(true);
    });
});
