import { clone as cloneDoc } from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { projectCrdtToStores } from '../projection/projectProjection';

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
 * The main branch's snapshot *is* the root slot (`rootDocId === DOC_PREFIX_ROOT`),
 * so its writeback is a no-op and is skipped.
 */
export function switchBranch(branchId: string): void {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    if (branchId === state.activeBranchId) {
        return;
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (!branch) {
        throw createBranchError(`Branch not found: ${branchId}`);
    }

    flushAutomergeStorageWrites();
    const branchDoc = automergeRepository.getDoc(branch.rootDocId);
    if (!branchDoc) {
        throw createBranchError(`Branch document not found: ${branch.rootDocId}`);
    }

    flushAutomergeStorageWrites();
    // 1. Write the outgoing active branch's live root-slot edits back into its
    //    own snapshot before we overwrite the root slot. Skip when the outgoing
    //    branch is backed directly by the root slot (main).
    const outgoing = state.branches.find((b) => b.branchId === state.activeBranchId);
    if (outgoing && outgoing.rootDocId !== DOC_PREFIX_ROOT) {
        const liveDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
        if (liveDoc) {
            automergeRepository.replaceDoc(outgoing.rootDocId, cloneDoc(liveDoc));
        }
    }

    // 2. Swap the root slot to point at the target branch's snapshot. Clone so
    //    edits to the active slot do not alias the stored snapshot handle.
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, cloneDoc(branchDoc));

    branchStore.set({ ...state, activeBranchId: branchId });
    projectCrdtToStores();

    // Persist the slot writeback + swap. Fire-and-forget so the (synchronous)
    // switch call site is unaffected; matches the persistence-side-effect
    // convention used elsewhere (e.g. AutomergeSync.persistCrdtProject().catch).
    void compactProject().catch((error) => {
        logger.warn('[switchBranch] Failed to persist after branch switch:', error);
    });
}
