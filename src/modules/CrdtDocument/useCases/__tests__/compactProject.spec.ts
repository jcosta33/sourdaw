import { describe, it, expect, vi, beforeEach } from 'vitest';

import { compactProject } from '../compactProject';

const mocks = vi.hoisted(() => ({
    saveAll: vi.fn(() => new Map()),
    saveAllToIdb: vi.fn(),
    clearIncrementalsFromIdb: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveAll: mocks.saveAll,
    },
}));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({ saveAllToIdb: mocks.saveAllToIdb }));
vi.mock('../../repositories/crdtPersistence/clearIncrementalsFromIdb', () => ({
    clearIncrementalsFromIdb: mocks.clearIncrementalsFromIdb,
}));

describe('compactProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should write full bundle and clear incrementals', async () => {
        const mockBundle = new Map([['doc1', new Uint8Array([4, 5, 6])]]);
        mocks.saveAll.mockReturnValue(mockBundle);

        await compactProject();

        expect(mocks.saveAllToIdb).toHaveBeenCalledWith(mockBundle);
        expect(mocks.clearIncrementalsFromIdb).toHaveBeenCalledWith('root');
    });
});
