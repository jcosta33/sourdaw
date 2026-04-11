import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/libraryPersistence', () => ({
    restoreLibrary: vi.fn().mockResolvedValue(undefined),
}));

import { restoreLibrary } from './restoreLibrary';
import { restoreLibrary as repoRestoreLibrary } from '../repositories/libraryPersistence';

describe('restoreLibrary', () => {
    beforeEach(() => {
        vi.mocked(repoRestoreLibrary).mockClear();
    });

    it('delegates to the repository implementation', async () => {
        await restoreLibrary();
        expect(repoRestoreLibrary).toHaveBeenCalledTimes(1);
    });
});
