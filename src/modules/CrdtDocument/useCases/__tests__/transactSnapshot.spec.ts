import { describe, it, expect, vi } from 'vitest';

import { type DocumentBundle } from '../crdtDocumentTypes';
import { transactSnapshot } from '../transactSnapshot';

type SnapshotBundle = {
    before: DocumentBundle;
    after: DocumentBundle;
};

const mocks = vi.hoisted(() => ({
    transactSnapshot: vi.fn<(callback: () => Promise<void>) => Promise<SnapshotBundle>>(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        transactSnapshot: mocks.transactSnapshot,
    },
}));

describe('transactSnapshot', () => {
    it('should delegate snapshot transaction execution to automergeRepository.transactSnapshot', async () => {
        const callback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const bundle: SnapshotBundle = {
            before: new Map([['before', new Uint8Array([1])]]),
            after: new Map([['after', new Uint8Array([2])]]),
        };
        mocks.transactSnapshot.mockImplementation(async (repositoryCallback) => {
            await repositoryCallback();
            return bundle;
        });

        await expect(transactSnapshot(callback)).resolves.toBe(bundle);

        expect(mocks.transactSnapshot).toHaveBeenCalledWith(callback);
        expect(mocks.transactSnapshot).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledTimes(1);
    });
});
