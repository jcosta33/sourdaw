import { clone as cloneDoc } from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { captureUndoHistory, clearUndoHistory, restoreUndoHistory } from '#/modules/Command/useCases';
import { isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';
import { valuesEqual } from '#/utils/structuralEquality';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchRecord, type BranchStoreState } from '../../stores/branchStore';
import { captureActiveBranchReference } from '../captureActiveBranchReference';

import { runBranchLineageTransition } from './runBranchLineageTransition';
import { saveActiveBranchSnapshot } from './saveActiveBranchSnapshot';

function clearUndoHistoryAfterFailedTransition(): void {
    try {
        clearUndoHistory();
    } catch (error) {
        logger.error(new Error('[switchBranch] Failed to clear undo history after branch recovery', { cause: error }));
    }
}

function restoreUndoHistoryForRecoveredBranch(
    capturedReference: ReturnType<typeof captureActiveBranchReference>,
    undoSnapshot: ReturnType<typeof captureUndoHistory>
): void {
    try {
        const recoveredReference = captureActiveBranchReference();
        if (capturedReference && recoveredReference && valuesEqual(capturedReference, recoveredReference)) {
            restoreUndoHistory(undoSnapshot);
            return;
        }
    } catch (error) {
        logger.error(
            new Error('[switchBranch] Failed to reconcile undo history after branch recovery', { cause: error })
        );
    }

    clearUndoHistoryAfterFailedTransition();
}

type BranchSwitchPlan = {
    state: BranchStoreState;
    branch: BranchRecord;
    activeBranch: BranchRecord;
};

/** `null` when there is nothing to switch: no branch state, or the target is already active. */
function planBranchSwitch(branchId: string): BranchSwitchPlan | null {
    const state = branchStore.value;
    if (!state) {
        return null;
    }

    if (branchId === state.activeBranchId) {
        return null;
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
    return { state, branch, activeBranch };
}

/**
 * Switch to a different branch.
 *
 * The transport stops first, and a recording in flight commits its take, while
 * the outgoing branch's document is still the root: a take left running would
 * record into the incoming branch, and the replace below clears undo mid-take.
 * A failed stop aborts the switch. Fork, merge and the failed-transition
 * rollback stay on one lineage and keep the runtime state.
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
    if (!planBranchSwitch(branchId)) {
        return;
    }

    await stopPlayback();

    // The stop awaits a recording commit, so another switch, fork or delete may
    // have moved the branch state since the first plan.
    const plan = planBranchSwitch(branchId);
    if (!plan) {
        return;
    }
    const { state, branch, activeBranch } = plan;

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
    // `apply()` below clears undo history. Recovery may restore these snapshots or
    // reload a different durable lineage, so retain both witnesses and reinstall
    // outgoing undo only when recovered branch/document truth matches exactly.
    // Keep this policy here (not in the undo-agnostic transition helper) so other
    // callers with narrower affected-document sets are not changed.
    const capturedReference = captureActiveBranchReference();
    const undoSnapshot = captureUndoHistory();
    // The stop published an idle transport at once and then awaited the
    // recording commit, so Record or Play pressed in that window is already
    // rolling. Nothing below awaits before `apply()` replaces the root, so this
    // check holds at the replace; a take or playback started now would run on
    // into the incoming branch. Refuse rather than stop again: the user's
    // newer gesture stands and the switch can be repeated.
    if (!isTransportIdle()) {
        throw createBranchError('The transport started while switching branches. Stop it and switch again.');
    }
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
        restoreUndoHistoryForRecoveredBranch(capturedReference, undoSnapshot);
        throw error;
    }
}
