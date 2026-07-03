import { describe, it, expect, vi, beforeEach } from 'vitest';

import { persistCrdtProject } from '../persistCrdtProject';

const mocks = vi.hoisted(() => ({
    saveDocIncremental: vi.fn(),
    saveIncrementalToIdb: vi.fn(),
    compactProject: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveDocIncremental: mocks.saveDocIncremental,
    },
}));
vi.mock('../../repositories/crdtPersistence/saveIncrementalToIdb', () => ({
    saveIncrementalToIdb: mocks.saveIncrementalToIdb,
}));
vi.mock('../compactProject', () => ({ compactProject: mocks.compactProject }));

describe('persistCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compactProject.mockResolvedValue(undefined);
    });

    it('should save incremental chunk to IDB', async () => {
        mocks.saveDocIncremental.mockReturnValue(new Uint8Array([1, 2, 3]));

        await persistCrdtProject();

        expect(mocks.saveIncrementalToIdb).toHaveBeenCalledWith('root', expect.any(Uint8Array));
    });
});
