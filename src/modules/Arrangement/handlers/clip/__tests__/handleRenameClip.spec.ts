import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRenameClip } from '../handleRenameClip';

const mocks = vi.hoisted(() => ({
    renameClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/renameClip', () => ({
    renameClip: mocks.renameClip,
}));

describe('handleRenameClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to renameClip use case', () => {
        handleRenameClip.execute({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'New Name' }
        });
        expect(mocks.renameClip).toHaveBeenCalledWith('c1', 'New Name');
    });
});
