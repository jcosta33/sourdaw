import { clone as cloneDoc, type Doc } from '@automerge/automerge';

import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';
import {
    captureAutomergeStorageTransactionScope,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { type DocId } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStateAuthority } from '../../repositories/branchStateAuthority';
import { branchStore, type BranchStoreState } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { currentPersistenceReplacement } from '../currentPersistenceReplacement';
import { loadCrdtProject } from '../loadCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';

import { branchDocumentTransitionFence } from './branchDocumentTransitionFence';

type DocumentSnapshot = {
    id: DocId;
    doc: Doc<unknown> | null;
};

export type RunBranchTransitionInput<TResult> = {
    affectedDocIds: DocId[];
    apply: () => { nextState?: BranchStoreState; result: TResult };
    persistenceOperation: () => Promise<void>;
    previousState: BranchStoreState;
    transitionOwnerId?: string;
};

let branchTransitionInProgress = false;

function createDocumentSnapshot(id: DocId): DocumentSnapshot {
    const doc = automergeRepository.getDoc(id);
    return { id, doc: doc ? cloneDoc(doc) : null };
}

function restoreDocumentSnapshot({ id, doc }: DocumentSnapshot, capturedRootIdentity: number): void {
    if (!doc) {
        automergeRepository.removeDoc(id);
        return;
    }
    if (automergeRepository.hasDoc(id)) {
        if (
            id === automergeRepository.getRootId() &&
            automergeRepository.getRootIdentityEpoch() === capturedRootIdentity
        ) {
            automergeRepository.replaceRootContentPreservingIdentity(cloneDoc(doc));
            return;
        }
        automergeRepository.replaceDoc(id, cloneDoc(doc));
        return;
    }
    automergeRepository.insertDoc(id, cloneDoc(doc));
}

function getDurableBranchState(error: unknown, previousState: BranchStoreState): BranchStoreState {
    if (!isAppError(error) || error._tag !== 'CrdtPersistenceRootLineageConflict') {
        return previousState;
    }
    const durableRootLineage = error.durableRootLineage;
    if (
        typeof durableRootLineage !== 'string' ||
        !previousState.branches.some(({ branchId }) => branchId === durableRootLineage)
    ) {
        return previousState;
    }
    return { ...previousState, activeBranchId: durableRootLineage };
}

async function recoverFailedTransition({
    error,
    previousState,
    capturedRootIdentity,
    snapshots,
    committedRevision,
    capturedReplacement,
}: {
    error: unknown;
    previousState: BranchStoreState;
    capturedRootIdentity: number;
    snapshots: DocumentSnapshot[];
    committedRevision: number | null;
    capturedReplacement: number;
}): Promise<void> {
    if (currentPersistenceReplacement() !== capturedReplacement) {
        // The project was replaced under this transition. The documents these
        // snapshots describe belong to a repository that no longer exists, and
        // the branch list the rollback would restore describes that repository
        // too — writing either back would put the replaced project's branches
        // over the replacement's.
        logger.warn('[CrdtDocument] Skipped branch transition rollback: the project was replaced mid-transition.');
        return;
    }

    for (const snapshot of snapshots) {
        restoreDocumentSnapshot(snapshot, capturedRootIdentity);
    }

    let recoveredState = previousState;
    try {
        const loaded = await loadCrdtProject();
        if (loaded) {
            recoveredState = getDurableBranchState(error, previousState);
        }
    } catch (recoveryError) {
        logger.warn('[CrdtDocument] Failed to reload persistence after branch rollback:', recoveryError);
    }

    if (committedRevision !== null) {
        // Only the transition's own commit can be rolled back, and only against
        // the revision it produced. A refusal means a successor committed in
        // the meantime, and that successor's list is the newer truth — the
        // transaction leaves the store holding it. Undoing it here would revert
        // a branch the user created after this transition failed.
        //
        // Memory goes back only on this path. The transition's own commit
        // landed, so `previousState` is the list it displaced; without that
        // commit whatever the caller captured is stale, and restoring it would
        // show a branch list no revision describes.
        branchStore.set(recoveredState);
        const rolledBack = await branchStateAuthority.commit({
            expectedRevision: committedRevision,
            next: recoveredState,
        });
        if (rolledBack.status === 'refused') {
            logger.warn(
                `[CrdtDocument] Rolled-back branch state was not persisted (${rolledBack.reason}); ` +
                    'durable branch state holds a later revision.'
            );
        }
    }

    projectCrdtToStores();
}

export async function runBranchTransition<TResult>({
    affectedDocIds,
    apply,
    persistenceOperation,
    previousState,
    transitionOwnerId,
}: RunBranchTransitionInput<TResult>): Promise<TResult> {
    if (branchTransitionInProgress || branchDocumentTransitionFence.isBlockedFor(transitionOwnerId)) {
        throw createBranchError('A branch transition is already in progress');
    }

    flushAutomergeStorageWrites();
    const capturedRootIdentity = automergeRepository.getRootIdentityEpoch();
    const expectedRevision = branchStateAuthority.captureRevision();
    // Captured here, synchronously, because the commit below takes a Web Lock
    // and an app action's ambient storage transaction ends at the handler's
    // first await. The branch-list projection has to stay inside the action
    // that asked for it: unattributed, it and the document writes its
    // subscribers make count as an outside writer, and a batch that detects one
    // revokes its own execution authority (Audit CC-10).
    const projectionScope = captureAutomergeStorageTransactionScope();
    const capturedReplacement = currentPersistenceReplacement();
    const snapshots = [...new Set(affectedDocIds)].map(createDocumentSnapshot);
    branchTransitionInProgress = true;

    let persistence: Promise<void> | null = null;
    let committedRevision: number | null = null;
    try {
        persistence = persistenceOperation();
        const { nextState, result } = apply();
        if (nextState) {
            // The last durable branch write before the document work is
            // awaited, as the store write it replaces was: a refused commit has
            // to unwind through the same rollback a thrown persistence error
            // does, and the rollback needs the documents still restorable.
            const committed = await branchStateAuthority.commit({
                expectedRevision,
                next: nextState,
                projectionScope,
            });
            if (committed.status === 'refused') {
                throw createBranchError(`Branch state could not be persisted (${committed.reason})`);
            }
            committedRevision = committed.revision;
        }
        projectCrdtToStores();

        await persistence;
        await compactProject();
        return result;
    } catch (error) {
        // Nothing awaits the persistence once the transition is unwinding, and
        // an unobserved rejection here would be reported as an unhandled one.
        void persistence?.catch(() => undefined);
        await recoverFailedTransition({
            error,
            previousState,
            capturedRootIdentity,
            snapshots,
            committedRevision,
            capturedReplacement,
        });
        throw error;
    } finally {
        branchTransitionInProgress = false;
    }
}
