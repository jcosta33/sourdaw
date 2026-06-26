import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../repositories/libraryPersistence/restoreLibrary', () => ({
    restoreLibrary: vi.fn(),
}));

vi.mock('../buildFolderTree', () => ({
    buildFolderTree: vi.fn(),
}));

import { restoreLibrary as repoRestoreLibrary } from '../../repositories/libraryPersistence/restoreLibrary';
import { buildFolderTree } from '../buildFolderTree';
import { restoreLibrary } from '../restoreLibrary';

describe('restoreLibrary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the IDB read to the repository implementation', async () => {
        vi.mocked(repoRestoreLibrary).mockResolvedValue([]);

        await restoreLibrary();

        expect(repoRestoreLibrary).toHaveBeenCalledTimes(1);
    });

    it('rebuilds a folder tree for each root the repository restored', async () => {
        vi.mocked(repoRestoreLibrary).mockResolvedValue(['r1', 'r2']);

        await restoreLibrary();

        expect(buildFolderTree).toHaveBeenCalledTimes(2);
        expect(buildFolderTree).toHaveBeenNthCalledWith(1, 'r1');
        expect(buildFolderTree).toHaveBeenNthCalledWith(2, 'r2');
    });

    it('rebuilds no trees when the repository restored nothing', async () => {
        vi.mocked(repoRestoreLibrary).mockResolvedValue([]);

        await restoreLibrary();

        expect(buildFolderTree).not.toHaveBeenCalled();
    });
});
