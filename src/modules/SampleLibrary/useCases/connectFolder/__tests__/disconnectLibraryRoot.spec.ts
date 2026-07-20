import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    persistSamples: vi.fn<() => Promise<void>>(),
    removeLibraryRoot: vi.fn<(rootId: string) => void>(),
}));

vi.mock('../../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persistSamples,
}));

vi.mock('../../../stores/libraryStore', () => ({
    removeLibraryRoot: mocks.removeLibraryRoot,
}));

import { disconnectLibraryRoot } from '../disconnectLibraryRoot';

describe('disconnectLibraryRoot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.persistSamples.mockResolvedValue(undefined);
    });

    it('removes the root from the store before persisting the reconciled state', async () => {
        const callOrder: string[] = [];
        mocks.removeLibraryRoot.mockImplementation(() => {
            callOrder.push('remove');
        });
        mocks.persistSamples.mockImplementation(async () => {
            callOrder.push('persist');
        });

        await disconnectLibraryRoot('root-1');

        expect(mocks.removeLibraryRoot).toHaveBeenCalledWith('root-1');
        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual(['remove', 'persist']);
    });

    it('propagates a persistence failure to the caller', async () => {
        mocks.persistSamples.mockRejectedValue(new Error('idb closed'));

        await expect(disconnectLibraryRoot('root-2')).rejects.toThrow('idb closed');
        expect(mocks.removeLibraryRoot).toHaveBeenCalledWith('root-2');
    });
});
