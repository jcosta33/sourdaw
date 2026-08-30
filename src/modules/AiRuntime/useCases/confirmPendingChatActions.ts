import { type refreshVersionedCommandBatchForApproval } from '#/modules/Command/useCases';

import { type ChatActionConfirmationStatus } from '../models/Chat';

import { beginConfirmedCommandExecution } from './agentRequestOrchestration/beginConfirmedCommandExecution';
import {
    type CommittedEffectFailureResult,
    type CommittedFinalizationEvidenceFailureResult,
} from './agentRequestOrchestration/confirmedBatchOutcomeSupport';
import { executeCommittedSectionRenderRetry } from './agentRequestOrchestration/executeCommittedSectionRenderRetry';
import { executeConfirmedCommandBatch } from './agentRequestOrchestration/executeConfirmedCommandBatch';
import { confirmationAdmission } from './agentRequestOrchestration/resolveConfirmationAdmission';
import { settleConfirmedCommandExecution } from './agentRequestOrchestration/settleConfirmedCommandExecution';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | CommittedEffectFailureResult
    | CommittedFinalizationEvidenceFailureResult
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | { status: 'reapproval_required'; divergence: ApprovalDivergence }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const admission = confirmationAdmission.consumeConfirmationAdmission(
        await confirmationAdmission.resolveConfirmationAdmission(input)
    );
    if (admission.status === 'handled') {
        return admission.result;
    }
    if (admission.status === 'render-retry') {
        return executeCommittedSectionRenderRetry({
            confirmation: admission.confirmation,
            durableReceipt: admission.durableReceipt,
            commandBatch: admission.commandBatch,
        });
    }
    const executionAdmission = beginConfirmedCommandExecution(admission);
    if (executionAdmission.status === 'settled') {
        return executionAdmission.result;
    }
    const executionFlight = await executeConfirmedCommandBatch({
        confirmation: executionAdmission.confirmation,
        commandBatch: executionAdmission.commandBatch,
        approvedBatchId: executionAdmission.approvedBatchId,
        trackedWorkLease: executionAdmission.trackedWorkLease,
        priorVerifiedBatchReceipt: executionAdmission.priorVerifiedBatchReceipt,
        recoveringPendingEffects: executionAdmission.recoveringPendingEffects,
    });
    return settleConfirmedCommandExecution({ executionAdmission, executionFlight });
}
