import { describe, it, expect, vi } from 'vitest';

import { restoreSnapshot } from '../restoreSnapshot';

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    restoreSnapshot: vi.fn(),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        restoreSnapshot: mocks.restoreSnapshot,
    },
}));

describe('restoreSnapshot', () => {
    it('should delegate the membership-aware snapshot to automergeRepository.restoreSnapshot', () => {
        const snapshot = new Map([['removed', { state: 'absent' as const }]]);

        restoreSnapshot(snapshot);

        expect(mocks.restoreSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restoreSnapshot).toHaveBeenCalledWith(snapshot);
        expect(mocks.flushAutomergeStorageWrites.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.restoreSnapshot.mock.invocationCallOrder[0]!
        );
    });
});
