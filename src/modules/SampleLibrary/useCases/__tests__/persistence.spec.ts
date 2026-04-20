import { describe, it, expect, vi, beforeEach } from 'vitest';

import { requestPermission } from '../requestPermission';
import { restoreLibrary } from '../restoreLibrary';

const mocks = vi.hoisted(() => ({
    restoreLibraryRepo: vi.fn(),
    requestPermissionRepo: vi.fn(),
}));

vi.mock('../../repositories/libraryPersistence/restoreLibrary', () => ({
    restoreLibrary: mocks.restoreLibraryRepo,
}));

vi.mock('../../repositories/libraryPersistence/requestPermission', () => ({
    requestPermission: mocks.requestPermissionRepo,
}));

describe('Sample Library Persistence Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('restoreLibrary delegates to repository', async () => {
        await restoreLibrary();
        expect(mocks.restoreLibraryRepo).toHaveBeenCalledTimes(1);
    });

    it('requestPermission delegates to repository', async () => {
        await requestPermission('r1');
        expect(mocks.requestPermissionRepo).toHaveBeenCalledWith('r1');
    });
});
