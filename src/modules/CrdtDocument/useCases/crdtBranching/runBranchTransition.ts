import { clone as cloneDoc, type Doc } from '@automerge/automerge';

import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { captureUndoHistory, restoreUndoHistory } from '#/modules/Command/useCases';

import { createBranchError } from '../../errors/BranchError';
import { type DocId } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchStoreState } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
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

function restoreDocumentSnapshot({ id, doc }: DocumentSnapshot): void {
    if (!doc) {
        automergeRepository.removeDoc(id);
        return;
    }
    if (automergeRepository.hasDoc(id)) {
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
    snapshots,
    undoSnapshot,
}: {
    error: unknown;
    previousState: BranchStoreState;
    snapshots: DocumentSnapshot[];
    undoSnapshot: ReturnType<typeof captureUndoHistory>;
}): Promise<void> {
    for (const snapshot of snapshots) {
        restoreDocumentSnapshot(snapshot);
    }
    // `apply()` may have cleared undo history (e.g. switchBranch, because the
    // root document it swapped in is gone again once the documents above are
    // rolled back). Restore what the user had before the attempt so a failed
    // transition does not silently erase it.
    restoreUndoHistory(undoSnapshot);

    let recoveredState = previousState;
    try {
        const loaded = await loadCrdtProject();
        if (loaded) {
            recoveredState = getDurableBranchState(error, previousState);
        }
    } catch (recoveryError) {
        logger.warn('[CrdtDocument] Failed to reload persistence after branch rollback:', recoveryError);
    }

    const persisted = branchStore.trySet(recoveredState);
    if (!persisted) {
        logger.warn('[CrdtDocument] Rolled-back branch state could not be persisted; it applies to this session only.');
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
    const snapshots = [...new Set(affectedDocIds)].map(createDocumentSnapshot);
    const undoSnapshot = captureUndoHistory();
    branchTransitionInProgress = true;

    try {
        const persistence = persistenceOperation();
        const { nextState, result } = apply();
        if (nextState) {
            branchStore.set(nextState);
        }
        projectCrdtToStores();

        await persistence;
        await compactProject();
        return result;
    } catch (error) {
        await recoverFailedTransition({ error, previousState, snapshots, undoSnapshot });
        throw error;
    } finally {
        branchTransitionInProgress = false;
    }
}
