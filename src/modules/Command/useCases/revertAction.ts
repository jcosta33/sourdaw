import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError } from '../errors/AppActionExecutionError';
import {
    claimActionReplayCapability,
    completeActionReplayMarkReconciliation,
    consumeActionReplayClaim,
    getActionReplayMarkReconciliation,
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
        const outcome = actionHistoryMetadataPort.markReverted({
            entryId,
            expectedFingerprint: claim.metadataFingerprint,
        });
        if (outcome.status === 'unavailable') {
            consumeActionReplayClaim({ entryId, claim });
            return;
        }
    } catch (error) {
        retainActionReplayMarkReconciliation({ entryId, claim });
        throw error;
    }

    consumeActionReplayClaim({ entryId, claim });
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
