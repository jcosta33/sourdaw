import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleReverseClip } from '../handleReverseClip';

const mocks = vi.hoisted(() => ({
    reverseClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/reverseClip', () => ({
    reverseClip: mocks.reverseClip,
}));

describe('handleReverseClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reverseClip.mockReturnValue(true);
    });

    it('executes reverseClip with the provided payload', () => {
        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'c1' },
        });

        expect(mocks.reverseClip).toHaveBeenCalledWith('c1');
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when reversal is rejected', () => {
        mocks.reverseClip.mockReturnValue(false);

        const result = handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'vca-clip' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleReverseClip.describe({
            type: 'reverseClip',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Reverse clip');
    });

    it('is undoable', () => {
        expect(handleReverseClip.undoable).toBe(true);
    });
});
