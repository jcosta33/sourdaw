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
    });

    it('executes reverseClip with the provided payload', () => {
        void handleReverseClip.execute({
            type: 'reverseClip',
            payload: { clipId: 'c1' },
        });

        expect(mocks.reverseClip).toHaveBeenCalledWith('c1');
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
