import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClip } from '../handleDuplicateClip';

const mocks = vi.hoisted(() => ({
    duplicateClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/duplicateClip', () => ({
    duplicateClip: mocks.duplicateClip,
}));

describe('handleDuplicateClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateClip with the provided payload', () => {
        void handleDuplicateClip.execute({
            type: 'duplicateClip',
            payload: { clipId: 'c1' },
        });

        expect(mocks.duplicateClip).toHaveBeenCalledWith('c1');
    });

    it('provides a description', () => {
        const desc = handleDuplicateClip.describe({
            type: 'duplicateClip',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip');
    });

    it('is undoable', () => {
        expect(handleDuplicateClip.undoable).toBe(true);
    });
});
