import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRenameClip } from '../handleRenameClip';

const mocks = vi.hoisted(() => ({
    renameClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/renameClip', () => ({
    renameClip: mocks.renameClip,
}));

describe('handleRenameClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes renameClip with the provided payload', () => {
        handleRenameClip.execute({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'New Name' },
        });

        expect(mocks.renameClip).toHaveBeenCalledWith('c1', 'New Name');
    });

    it('provides a description reflecting the new name', () => {
        const desc = handleRenameClip.describe({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'New Name' },
        });
        expect(desc.label).toBe('Rename clip to "New Name"');
    });

    it('is undoable', () => {
        expect(handleRenameClip.undoable).toBe(true);
    });
});
