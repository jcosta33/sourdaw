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
    });

    it('executes splitClip with the provided payload', () => {
        void handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 2.5);
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
