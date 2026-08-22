import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collaborationStore } from '../../../stores/collaborationStore';
import { collaborationAssetOwnership, configureCollaborationAssetOwner } from '../getCollaborationAssetOwnerId';

const mocks = vi.hoisted(() => ({
    reconcileOwnedAssets: vi.fn(),
}));

vi.mock('../../../repositories/durableAssetRepository', () => ({
    createDurableAssetRepository: () => ({ reconcileOwnedAssets: mocks.reconcileOwnedAssets }),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn() } }));

describe('Collaboration durable asset ownership projection', () => {
    let publishReferencedHashes: (hashes: readonly string[]) => void = () => undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reconcileOwnedAssets.mockResolvedValue({
            status: 'reconciled',
            releasedHashes: [],
            removedHashes: [],
        });
        collaborationStore.set(null);
        configureCollaborationAssetOwner({
            captureOwnerId: () => 'project:authoritative',
            subscribeOwnerId: () => () => undefined,
            captureReferencedHashes: () => [],
            subscribeReferencedHashes: (listener) => {
                publishReferencedHashes = listener;
                return () => undefined;
            },
        });
    });

    it('reconciles exact project references outside a live session and leaves join ordering to the session owner', async () => {
        publishReferencedHashes(['sha256:referenced']);
        await collaborationAssetOwnership.flushReconciliation();

        expect(mocks.reconcileOwnedAssets).toHaveBeenCalledExactlyOnceWith(['sha256:referenced']);

        collaborationStore.set({ isEnabled: true } as never);
        publishReferencedHashes([]);
        await collaborationAssetOwnership.flushReconciliation();

        expect(mocks.reconcileOwnedAssets).toHaveBeenCalledTimes(1);
    });
});
