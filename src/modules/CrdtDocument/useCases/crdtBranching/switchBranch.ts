import { clone as cloneDoc, type Doc } from '@automerge/automerge';

import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT, type DocId } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchStoreState } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { loadCrdtProject } from '../loadCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

import { saveActiveBranchSnapshot } from './saveActiveBranchSnapshot';

type DocumentSnapshot = {
    id: DocId;
    doc: Doc<unknown> | null;
};

let branchSwitchInProgress = false;

/**
 * Switch to a different branch.
 *
 * Slot model: `DOC_PREFIX_ROOT` always mirrors the *active* branch's working
 * document (all edits, persistence and projection target it), while each branch
 * keeps its own snapshot under `branch.rootDocId`. Switching therefore has two
 * halves:
 *   1. Flush the outgoing branch's live edits from the root slot back into its
 *      own snapshot, so they are not left aliased/stale behind the new active
 *      branch.
 *   2. Load the target branch's snapshot into the root slot.
 * Legacy root-backed main records are migrated to a distinct backing document
 * the first time main becomes inactive.
 */
export async function switchBranch(branchId: string): Promise<void> {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    if (branchId === state.activeBranchId) {
        return;
    }
    if (branchSwitchInProgress) {
        throw createBranchError('A branch switch is already in progress');
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (!branch) {
        throw createBranchError(`Branch not found: ${branchId}`);
    }
    if (branch.rootDocId === DOC_PREFIX_ROOT) {
        throw createBranchError(`Branch has no independent backing document: ${branchId}`);
    }

    const activeBranch = state.branches.find(({ branchId: candidateId }) => candidateId === state.activeBranchId);
    if (!activeBranch) {
        throw createBranchError(`Active branch not found: ${state.activeBranchId}`);
    }

    flushAutomergeStorageWrites();
    const liveDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!liveDoc) {
        throw createBranchError('Active root document not found');
    }
    const branchDoc = automergeRepository.getDoc(branch.rootDocId);
    if (!branchDoc) {
        throw createBranchError(`Branch document not found: ${branch.rootDocId}`);
    }

    const outgoingDocId =
        activeBranch.rootDocId === DOC_PREFIX_ROOT ? `branch_${activeBranch.branchId}` : activeBranch.rootDocId;
    const previousDocuments = [createDocumentSnapshot(DOC_PREFIX_ROOT), createDocumentSnapshot(outgoingDocId)];

    branchSwitchInProgress = true;
    try {
        flushAutomergeStorageWrites();
        const lineageTransition = runCrdtPersistenceOperation({
            type: 'root-lineage-transition',
            from: state.activeBranchId,
            to: branchId,
        });
        const stateWithOutgoingSnapshot = saveActiveBranchSnapshot({ state, liveRoot: liveDoc });

        automergeRepository.replaceDoc(DOC_PREFIX_ROOT, cloneDoc(branchDoc));
        branchStore.set({ ...stateWithOutgoingSnapshot, activeBranchId: branchId });
        projectCrdtToStores();

        await lineageTransition;
        await compactProject();
    } catch (error) {
        await recoverFailedBranchSwitch({ error, previousDocuments, previousState: state });
        throw error;
    } finally {
        branchSwitchInProgress = false;
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

type RecoverFailedBranchSwitchInput = {
    error: unknown;
    previousDocuments: DocumentSnapshot[];
    previousState: BranchStoreState;
};

async function recoverFailedBranchSwitch({
    error,
    previousDocuments,
    previousState,
}: RecoverFailedBranchSwitchInput): Promise<void> {
    for (const snapshot of previousDocuments) {
        restoreDocumentSnapshot(snapshot);
    }

    let recoveredState = previousState;
    try {
        const loaded = await loadCrdtProject();
        if (loaded) {
            recoveredState = getDurableBranchState(error, previousState);
        }
    } catch (recoveryError) {
        logger.warn('[switchBranch] Failed to reload persistence after rollback:', recoveryError);
    }

    branchStore.set(recoveredState);
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
