import { clone as cloneDoc } from '@automerge/automerge';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { captureUndoHistory, clearUndoHistory, restoreUndoHistory } from '#/modules/Command/useCases';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { runBranchLineageTransition } from './runBranchLineageTransition';
import { saveActiveBranchSnapshot } from './saveActiveBranchSnapshot';

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
    // `apply()` below clears undo history; `affectedDocIds` includes the root, so
    // a rolled-back document snapshot leaves the pre-switch undo stack matching
    // what the user had. Restore it here (not in runBranchTransition, which is
    // undo-agnostic) so callers with a narrower affected-doc set, such as the
    // drum-preview branch handlers, are not affected by this compensation.
    const undoSnapshot = captureUndoHistory();
    try {
        await runBranchLineageTransition({
            affectedDocIds: [DOC_PREFIX_ROOT, outgoingDocId],
            from: state.activeBranchId,
            previousState: state,
            to: branchId,
            apply: () => {
                const stateWithOutgoingSnapshot = saveActiveBranchSnapshot({ state, liveRoot: liveDoc });
                automergeRepository.replaceDoc(DOC_PREFIX_ROOT, cloneDoc(branchDoc));
                // The root slot now holds a different branch's document, so undo
                // entries recorded against the outgoing branch's document would
                // replay an inverse against a document that is no longer active.
                // Same reasoning as switchArrangement clearing undo history on
                // snapshot load.
                clearUndoHistory();
                return {
                    nextState: { ...stateWithOutgoingSnapshot, activeBranchId: branchId },
                    result: undefined,
                };
            },
        });
    } catch (error) {
        restoreUndoHistory(undoSnapshot);
        throw error;
    }
}
