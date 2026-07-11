import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError } from '../errors/AppActionExecutionError';
import {
    claimActionReplayCapability,
    completeActionReplayMarkReconciliation,
    consumeActionReplayClaim,
    hasActionReplayMarkReconciliation,
    restoreActionReplayCapability,
    retainActionReplayMarkReconciliation,
} from '../stores/actionReplayCapabilities';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { executeAppAction } from './executeAppAction';

type ActionReplayClaim = NonNullable<ReturnType<typeof claimActionReplayCapability>>;

type MarkCommittedReplayInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

function markCommittedReplay({ entryId, claim }: MarkCommittedReplayInput): void {
    try {
        actionHistoryMetadataPort.markReverted(entryId);
    } catch (error) {
        retainActionReplayMarkReconciliation({ entryId, claim });
        throw error;
    }

    consumeActionReplayClaim({ entryId, claim });
}

function retryActionReplayMark(entryId: string): void {
    actionHistoryMetadataPort.markReverted(entryId);
    completeActionReplayMarkReconciliation(entryId);
}

type RevertActionOutput = Promise<{ status: 'executed' } | { status: 'reconciled' } | { status: 'unavailable' }>;

export async function revertAction(entryId: string): RevertActionOutput {
    const entry = actionHistoryStore.value?.entries.find((history_entry) => history_entry.id === entryId);
    if (!entry) {
        return { status: 'unavailable' };
    }

    if (entry.reverted) {
        completeActionReplayMarkReconciliation(entryId);
        return { status: 'unavailable' };
    }

    if (hasActionReplayMarkReconciliation(entryId)) {
        retryActionReplayMark(entryId);
        return { status: 'reconciled' };
    }

    const claim = claimActionReplayCapability({ entryId, metadata: entry });
    if (!claim) {
        return { status: 'unavailable' };
    }

    try {
        await executeAppAction(claim.inverseAction, {
            source: entry.source,
            groupLabel: `Reverted: ${entry.label}`,
        });
    } catch (error) {
        if (error instanceof AppActionCommittedError) {
            try {
                markCommittedReplay({ entryId, claim });
            } catch (mark_error) {
                throw new AggregateError(
                    [error, mark_error],
                    `Action replay committed but metadata reconciliation failed: ${entryId}`,
                    { cause: mark_error }
                );
            }
            throw error;
        }

        restoreActionReplayCapability({ entryId, claim });
        throw error;
    }

    markCommittedReplay({ entryId, claim });
    return { status: 'executed' };
}
