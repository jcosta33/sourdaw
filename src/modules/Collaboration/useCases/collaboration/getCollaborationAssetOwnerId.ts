import { logger } from '#/infra/logger/appLogger';

import { createDurableAssetRepository } from '../../repositories/durableAssetRepository';
import { collaborationStore } from '../../stores/collaborationStore';

type CollaborationAssetOwnershipProvider = {
    captureOwnerId: () => string | undefined;
    subscribeOwnerId: (listener: (ownerId: string | undefined) => void) => () => void;
    captureReferencedHashes: () => readonly string[];
    subscribeReferencedHashes: (listener: (hashes: readonly string[]) => void) => () => void;
};

let provider: CollaborationAssetOwnershipProvider | null = null;
let unsubscribeProductionReferences: (() => void) | null = null;
let productionReconciliationTask = Promise.resolve();

export function configureCollaborationAssetOwner(nextProvider: CollaborationAssetOwnershipProvider): void {
    unsubscribeProductionReferences?.();
    provider = nextProvider;
    unsubscribeProductionReferences = nextProvider.subscribeReferencedHashes((referencedHashes) => {
        // An active session owns synchronization ordering: a joiner's local
        // project identity is stale until host CRDT truth arrives. Outside a
        // session, each authoritative Arrangement projection can safely retire
        // this project's unreferenced originals.
        if (collaborationStore.value?.isEnabled) {
            return;
        }
        const ownerId = nextProvider.captureOwnerId();
        if (!ownerId) {
            return;
        }
        productionReconciliationTask = productionReconciliationTask
            .then(async () => {
                const result = await createDurableAssetRepository(ownerId).reconcileOwnedAssets(referencedHashes);
                if (result.status === 'failed') {
                    throw new Error(`Durable asset reference reconciliation failed: ${result.reason}`);
                }
            })
            .catch((error: unknown) => {
                logger.error(new Error('Collaboration durable asset ownership update failed', { cause: error }));
            });
    });
}

export const collaborationAssetOwnership = {
    /** Capture the active project's opaque durable-asset owner identity. */
    getOwnerId(): string {
        const ownerId = provider?.captureOwnerId();
        if (!ownerId) {
            throw new Error('The active project has no durable asset owner identity');
        }
        return ownerId;
    },
    subscribeOwner(listener: (ownerId: string | undefined) => void): () => void {
        return provider?.subscribeOwnerId(listener) ?? (() => undefined);
    },
    getReferencedHashes(): readonly string[] {
        return provider?.captureReferencedHashes() ?? [];
    },
    subscribeReferencedHashes(listener: (hashes: readonly string[]) => void): () => void {
        return provider?.subscribeReferencedHashes(listener) ?? (() => undefined);
    },
    flushReconciliation(): Promise<void> {
        return productionReconciliationTask;
    },
};
