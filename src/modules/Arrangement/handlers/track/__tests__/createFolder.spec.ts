import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateFolder } from '../createFolder';

const mocks = vi.hoisted(() => ({
    createFolder: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/folder/createFolder', () => ({
    createFolder: mocks.createFolder,
}));

describe('handleCreateFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createFolder with the provided payload', () => {
        void handleCreateFolder.execute({
            type: 'createFolder',
            payload: { name: 'Drums' },
        });

        expect(mocks.createFolder).toHaveBeenCalledWith('Drums');
    });

    it('provides a description', () => {
        const desc = handleCreateFolder.describe({
            type: 'createFolder',
            payload: { name: 'Drums' },
        });
        expect(desc.label).toBe('Create folder "Drums"');
    });

    it('is undoable', () => {
        expect(handleCreateFolder.undoable).toBe(true);
    });
});
