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
    let publishProjectEpoch: (snapshot: {
        ownerId: string | undefined;
        epoch: number;
        committed: boolean;
    }) => void = () => undefined;
    let ownerId = 'project:authoritative';
    let epoch = 1;
    let committed = true;
    let referencedHashes: readonly string[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        ownerId = 'project:authoritative';
        epoch = 1;
        committed = true;
        referencedHashes = [];
        mocks.reconcileOwnedAssets.mockResolvedValue({
            status: 'reconciled',
            releasedHashes: [],
            removedHashes: [],
        });
        collaborationStore.set(null);
        configureCollaborationAssetOwner({
            captureProjectEpoch: () => ({ ownerId, epoch, committed }),
            subscribeProjectEpoch: (listener) => {
                publishProjectEpoch = listener;
                return () => undefined;
            },
            captureReferencedHashes: () => referencedHashes,
            subscribeReferencedHashes: (listener) => {
                publishReferencedHashes = (hashes) => {
                    referencedHashes = hashes;
                    listener(hashes);
                };
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

    it('does not retire the committed project when a replacement transition empties tracks before publishing its identity', async () => {
        publishReferencedHashes(['sha256:old-project-original']);
        await collaborationAssetOwnership.flushReconciliation();
        vi.clearAllMocks();

        // Project replacement activates before Arrangement hydration. The
        // empty projection belongs to the next epoch even though Project has
        // not published its new id yet.
        epoch = 2;
        committed = false;
        publishReferencedHashes([]);
        ownerId = 'project:replacement';
        publishReferencedHashes(['sha256:replacement-original']);
        committed = true;
        publishProjectEpoch({ ownerId, epoch, committed });
        await collaborationAssetOwnership.flushReconciliation();

        expect(mocks.reconcileOwnedAssets).not.toHaveBeenCalledWith([]);
        expect(mocks.reconcileOwnedAssets).toHaveBeenCalledExactlyOnceWith(['sha256:replacement-original']);
    });
});
