import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSplitClip } from '../handleSplitClip';

const mocks = vi.hoisted(() => ({
    splitClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/splitClip', () => ({
    splitClip: mocks.splitClip,
}));

describe('handleSplitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.splitClip.mockReturnValue('right-clip');
    });

    it('executes splitClip with the provided payload', () => {
        const result = handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 2.5);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the split is rejected', () => {
        mocks.splitClip.mockReturnValue(null);

        const result = handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleSplitClip.describe({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });
        expect(desc.label).toBe('Split clip');
    });

    it('is undoable', () => {
        expect(handleSplitClip.undoable).toBe(true);
    });
});
