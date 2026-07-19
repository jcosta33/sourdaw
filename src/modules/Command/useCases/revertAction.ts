import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError } from '../errors/AppActionExecutionError';
import {
    claimActionReplayCapability,
    completeActionReplayMarkReconciliation,
    consumeActionReplayClaim,
    getActionReplayMarkReconciliation,
    isActionReplayClaimCurrent,
    restoreActionReplayCapability,
    retainActionReplayMarkReconciliation,
} from '../stores/actionReplayCapabilities';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { runCommandMutationExclusive } from './commandMutation';
import { type CommandMutationOwner } from './commandMutationOwner';
import { executeAppActionImpl } from './executeAppActionImpl';

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

type RevertActionOutput = Promise<
    { status: 'executed' } | { status: 'executed-unmarked' } | { status: 'reconciled' } | { status: 'unavailable' }
>;

async function revertActionUnderMutation(owner: CommandMutationOwner, entryId: string): RevertActionOutput {
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

    // Capability generations can be revoked by non-replay audit/reset paths.
    // Recheck at the last synchronous boundary before the inverse write.
    if (!isActionReplayClaimCurrent({ entryId, claim })) {
        return { status: 'unavailable' };
    }

    try {
        await executeAppActionImpl(
            claim.inverseAction,
            {
                source: entry.source,
                groupLabel: `Reverted: ${entry.label}`,
            },
            owner
        );
    } catch (error) {
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

export function revertAction(entryId: string): RevertActionOutput {
    return runCommandMutationExclusive((owner) => revertActionUnderMutation(owner, entryId));
}
