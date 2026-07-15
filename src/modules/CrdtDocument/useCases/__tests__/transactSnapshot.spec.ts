import { describe, it, expect, vi } from 'vitest';

import { transactSnapshot } from '../transactSnapshot';

type SnapshotEntry = { readonly state: 'present'; readonly bytes: Uint8Array } | { readonly state: 'absent' };

type SnapshotBundle = {
    before: Map<string, SnapshotEntry>;
    after: Map<string, SnapshotEntry>;
};

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    transactSnapshot: vi.fn<(callback: (transaction: object) => Promise<void>) => Promise<SnapshotBundle>>(),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        transactSnapshot: mocks.transactSnapshot,
    },
}));

describe('transactSnapshot', () => {
    it('flushes only deferred storage writes owned by the repository-issued transaction', async () => {
        const transaction = {};
        const callback = vi.fn<(transaction: object) => Promise<void>>().mockResolvedValue(undefined);
        const bundle: SnapshotBundle = {
            before: new Map([['before', { state: 'present', bytes: new Uint8Array([1]) }]]),
            after: new Map([['after', { state: 'present', bytes: new Uint8Array([2]) }]]),
        };
        mocks.transactSnapshot.mockImplementation(async (repositoryCallback) => {
            await repositoryCallback(transaction);
            return bundle;
        });

        await expect(transactSnapshot(callback)).resolves.toBe(bundle);

        expect(mocks.transactSnapshot).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(transaction);
        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledWith(transaction);
        expect(callback.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.flushAutomergeStorageWrites.mock.invocationCallOrder[0]!
        );
    });
});
