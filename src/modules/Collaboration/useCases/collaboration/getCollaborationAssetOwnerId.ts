import { logger } from '#/infra/logger/appLogger';

import { createDurableAssetRepository } from '../../repositories/durableAssetRepository';
import { collaborationStore } from '../../stores/collaborationStore';

type CollaborationAssetOwnershipProvider = {
    captureProjectEpoch: () => CollaborationAssetProjectEpoch;
    subscribeProjectEpoch: (listener: (epoch: CollaborationAssetProjectEpoch) => void) => () => void;
    captureReferencedHashes: () => readonly string[];
    subscribeReferencedHashes: (listener: (hashes: readonly string[]) => void) => () => void;
};

type CollaborationAssetProjectEpoch = {
    ownerId: string | undefined;
    epoch: number;
    committed: boolean;
};

let provider: CollaborationAssetOwnershipProvider | null = null;
let unsubscribeProductionReferences: (() => void) | null = null;
let unsubscribeProductionProjectEpoch: (() => void) | null = null;
let productionReconciliationTask = Promise.resolve();
let committedProjectEpoch: Pick<CollaborationAssetProjectEpoch, 'ownerId' | 'epoch'> | null = null;
const ownerListeners = new Set<(ownerId: string | undefined) => void>();

function sameCommittedProjectEpoch(snapshot: CollaborationAssetProjectEpoch): boolean {
    return (
        snapshot.committed &&
        snapshot.ownerId !== undefined &&
        snapshot.ownerId === committedProjectEpoch?.ownerId &&
        snapshot.epoch === committedProjectEpoch.epoch
    );
}

function queueReconciliation(ownerId: string, referencedHashes: readonly string[]): void {
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
}

export function configureCollaborationAssetOwner(nextProvider: CollaborationAssetOwnershipProvider): void {
    unsubscribeProductionReferences?.();
    unsubscribeProductionProjectEpoch?.();
    provider = nextProvider;
    const initialProjectEpoch = nextProvider.captureProjectEpoch();
    if (!sameCommittedProjectEpoch(initialProjectEpoch)) {
        committedProjectEpoch =
            initialProjectEpoch.committed && initialProjectEpoch.ownerId
                ? { ownerId: initialProjectEpoch.ownerId, epoch: initialProjectEpoch.epoch }
                : null;
    }
    unsubscribeProductionProjectEpoch = nextProvider.subscribeProjectEpoch((projectEpoch) => {
        if (!projectEpoch.committed || !projectEpoch.ownerId) {
            return;
        }
        const ownerChanged = projectEpoch.ownerId !== committedProjectEpoch?.ownerId;
        committedProjectEpoch = { ownerId: projectEpoch.ownerId, epoch: projectEpoch.epoch };
        if (ownerChanged) {
            for (const listener of ownerListeners) {
                listener(projectEpoch.ownerId);
            }
        }
        if (!collaborationStore.value?.isEnabled) {
            queueReconciliation(projectEpoch.ownerId, nextProvider.captureReferencedHashes());
        }
    });
    unsubscribeProductionReferences = nextProvider.subscribeReferencedHashes((referencedHashes) => {
        // An active session owns synchronization ordering: a joiner's local
        // project identity is stale until host CRDT truth arrives. Outside a
        // session, each authoritative Arrangement projection can safely retire
        // this project's unreferenced originals.
        if (collaborationStore.value?.isEnabled) {
            return;
        }
        const projectEpoch = nextProvider.captureProjectEpoch();
        const ownerId = projectEpoch.ownerId;
        if (!ownerId || !sameCommittedProjectEpoch(projectEpoch)) {
            return;
        }
        queueReconciliation(ownerId, referencedHashes);
    });
}

export const collaborationAssetOwnership = {
    /** Capture the active project's opaque durable-asset owner identity. */
    getOwnerId(): string {
        const projectEpoch = provider?.captureProjectEpoch();
        const ownerId = projectEpoch && sameCommittedProjectEpoch(projectEpoch) ? projectEpoch.ownerId : undefined;
        if (!ownerId) {
            throw new Error('The active project has no durable asset owner identity');
        }
        return ownerId;
    },
    subscribeOwner(listener: (ownerId: string | undefined) => void): () => void {
        ownerListeners.add(listener);
        return () => ownerListeners.delete(listener);
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
