import { clone as cloneDoc, type Doc } from '@automerge/automerge';

import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { type DocId } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchStoreState } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { loadCrdtProject } from '../loadCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

type DocumentSnapshot = {
    id: DocId;
    doc: Doc<unknown> | null;
};

type BranchTransitionResult<TResult> = {
    nextState?: BranchStoreState;
    result: TResult;
};

type RunBranchLineageTransitionInput<TResult> = {
    affectedDocIds: DocId[];
    apply: () => BranchTransitionResult<TResult>;
    from: string;
    previousState: BranchStoreState;
    to: string;
};

let branchTransitionInProgress = false;

export async function runBranchLineageTransition<TResult>({
    affectedDocIds,
    apply,
    from,
    previousState,
    to,
}: RunBranchLineageTransitionInput<TResult>): Promise<TResult> {
    if (branchTransitionInProgress) {
        throw createBranchError('A branch transition is already in progress');
    }

    flushAutomergeStorageWrites();
    const snapshots = [...new Set(affectedDocIds)].map(createDocumentSnapshot);
    branchTransitionInProgress = true;

    try {
        const lineageTransition = runCrdtPersistenceOperation({ type: 'root-lineage-transition', from, to });
        const { nextState, result } = apply();
        if (nextState) {
            branchStore.set(nextState);
        }
        projectCrdtToStores();

        await lineageTransition;
        await compactProject();
        return result;
    } catch (error) {
        await recoverFailedTransition({ error, previousState, snapshots });
        throw error;
    } finally {
        branchTransitionInProgress = false;
    }
}

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

type RecoverFailedTransitionInput = {
    error: unknown;
    previousState: BranchStoreState;
    snapshots: DocumentSnapshot[];
};

async function recoverFailedTransition({
    error,
    previousState,
    snapshots,
}: RecoverFailedTransitionInput): Promise<void> {
    for (const snapshot of snapshots) {
        restoreDocumentSnapshot(snapshot);
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

    // Past the point where a throw is useful: the documents above have already
    // been rolled back, and `projectCrdtToStores()` below is what puts the
    // stores back in step with them. Letting a refused `localStorage` write
    // unwind from here would skip that projection and leave the rollback itself
    // half-applied — a worse state than the failed transition it was undoing.
    // The recovered state is live either way; only its durability is at stake.
    const persisted = branchStore.trySet(recoveredState);
    if (!persisted) {
        logger.warn('[CrdtDocument] Rolled-back branch state could not be persisted; it applies to this session only.');
    }

    projectCrdtToStores();
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
