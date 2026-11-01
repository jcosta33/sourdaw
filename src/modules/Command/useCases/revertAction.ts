import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { type UndoEntry } from '../models/UndoEntry';
import {
    claimActionReplayCapability,
    completeActionReplayMarkReconciliation,
    consumeActionReplayClaim,
    getActionReplayMarkReconciliation,
    isActionReplayClaimCurrent,
    restoreActionReplayCapability,
    retainActionReplayMarkReconciliation,
} from '../stores/actionReplayCapabilities';
import { undoStore } from '../stores/undoStore';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { executeAppAction } from './executeAppAction';
import { runPreparedUndoReplay } from './undoReplayPreparationPort';

type ActionReplayClaim = NonNullable<ReturnType<typeof claimActionReplayCapability>>;

type MarkCommittedReplayInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

function markCommittedReplay({ entryId, claim }: MarkCommittedReplayInput): 'marked' | 'unavailable' {
    if (!isActionReplayClaimCurrent({ entryId, claim })) {
        return 'unavailable';
    }

    try {
        const outcome = actionHistoryMetadataPort.markReverted({
            entryId,
            expectedFingerprint: claim.metadataFingerprint,
        });
        if (outcome.status === 'unavailable') {
            consumeActionReplayClaim({ entryId, claim });
            return 'unavailable';
        }
    } catch (error) {
        retainActionReplayMarkReconciliation({ entryId, claim });
        throw error;
    }

    consumeActionReplayClaim({ entryId, claim });
    return 'marked';
}

type RetryActionReplayMarkInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

function retryActionReplayMark({ entryId, claim }: RetryActionReplayMarkInput): boolean {
    const outcome = actionHistoryMetadataPort.markReverted({
        entryId,
        expectedFingerprint: claim.metadataFingerprint,
    });
    completeActionReplayMarkReconciliation(entryId);
    return outcome.status === 'marked';
}

/** The undo entry this action's replay comes from, while the history still holds
 * it: the buffers it names may only be resident again once the replay prepares. */
function readUndoHistoryEntries(entryId: string): UndoEntry[] {
    const state = undoStore.value;
    if (!state) {
        return [];
    }
    return [...state.past, ...state.future].filter((candidate) => candidate.id === entryId);
}

type RevertActionOutput = Promise<
    | { status: 'executed' }
    | { status: 'executed-unmarked' }
    | { status: 'reconciled' }
    | { status: 'unavailable' }
    | { status: 'conflict' }
>;

export async function revertAction(entryId: string): RevertActionOutput {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry) {
        return { status: 'unavailable' };
    }

    if (entry.reverted) {
        completeActionReplayMarkReconciliation(entryId);
        return { status: 'unavailable' };
    }

    const reconciliation_claim = getActionReplayMarkReconciliation({ entryId, metadata: entry });
    if (reconciliation_claim) {
        return retryActionReplayMark({ entryId, claim: reconciliation_claim })
            ? { status: 'reconciled' }
            : { status: 'unavailable' };
    }

    const claim = claimActionReplayCapability({ entryId, metadata: entry });
    if (!claim) {
        return { status: 'unavailable' };
    }

    try {
        await runPreparedUndoReplay(readUndoHistoryEntries(entryId), () =>
            executeAppAction(claim.inverseAction, {
                undoEntryId: entryId,
                source: entry.source,
                groupLabel: `Reverted: ${entry.label}`,
            })
        );
    } catch (error) {
        if (error instanceof AppActionConflictError) {
            restoreActionReplayCapability({ entryId, claim });
            return { status: 'conflict' };
        }
        if (error instanceof AppActionCommittedError) {
            let mark_outcome: 'marked' | 'unavailable';
            try {
                mark_outcome = markCommittedReplay({ entryId, claim });
            } catch (mark_error) {
                throw new AggregateError(
                    [error, mark_error],
                    `Action replay committed but metadata reconciliation failed: ${entryId}`,
                    { cause: mark_error }
                );
            }
            if (mark_outcome === 'unavailable') {
                return { status: 'executed-unmarked' };
            }
            throw error;
        }

        restoreActionReplayCapability({ entryId, claim });
        throw error;
    }

    const mark_outcome = markCommittedReplay({ entryId, claim });
    return mark_outcome === 'marked' ? { status: 'executed' } : { status: 'executed-unmarked' };
}
