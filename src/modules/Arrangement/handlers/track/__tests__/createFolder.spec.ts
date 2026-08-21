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

    it('executes createFolder with the provided payload and reports the write', () => {
        mocks.createFolder.mockReturnValue(true);

        const result = handleCreateFolder.execute({
            type: 'createFolder',
            payload: { name: 'Drums', folderTrackId: 'folder-1' },
        });

        expect(mocks.createFolder).toHaveBeenCalledWith('Drums', 'folder-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when the track store was unavailable and no folder was created', () => {
        // Reporting `written` here files an undo entry for a write that never happened.
        // Its inverse can only ever conflict, and a conflicted entry stays at the top of
        // the stack refusing every later undo press.
        mocks.createFolder.mockReturnValue(false);

        const result = handleCreateFolder.execute({
            type: 'createFolder',
            payload: { name: 'Drums', folderTrackId: 'folder-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCreateFolder.describe({
            type: 'createFolder',
            payload: { name: 'Drums', folderTrackId: 'folder-1' },
        });
        expect(desc.label).toBe('Create folder "Drums"');
    });

    it('emits an inverse naming exactly the materialized folder track id, and a redo of the original action', () => {
        const action = {
            type: 'createFolder' as const,
            payload: { name: 'Drums', folderTrackId: 'folder-1' },
        };

        const desc = handleCreateFolder.describe(action);

        expect(desc.inverseAction).toEqual({
            type: 'discardCreatedTracks',
            payload: { trackIds: ['folder-1'] },
        });
        expect(desc.redoAction).toBe(action);
    });

    it('emits no inverse when the folder track id was never materialized', () => {
        const desc = handleCreateFolder.describe({
            type: 'createFolder',
            payload: { name: 'Drums' },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleCreateFolder.undoable).toBe(true);
    });
});
