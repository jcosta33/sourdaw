import { parseVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type AgentRunPendingEffect } from '../../models/AgentRun';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { hasExactAgentCommandBatchAuthority } from '../../validators/hasExactAgentCommandBatchAuthority';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getExactAgentActionHash } from '../getExactAgentActionHash';

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type ApprovedCommandBatch = NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
type ValidApprovedCommandBatch = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];
type ApprovedCommand = ValidApprovedCommandBatch['commands'][number];
type ApprovedRenderAction = Extract<
    PendingAppActionConfirmation['approvalSnapshot']['actions'][number],
    { type: 'renderProjectSections' }
>;

type EligibilityInput = {
    confirmation: PendingAppActionConfirmation;
    expectedCommandBatch?: ApprovedCommandBatch;
    phase: 'eligibility';
};

type ProofInput = {
    confirmation: PendingAppActionConfirmation;
    durableReceipt: CommandVerifiedBatchReceipt | null;
    expectedCommandBatch?: ApprovedCommandBatch;
    phase: 'proof';
};

type ArmingInput = {
    confirmation: PendingAppActionConfirmation;
    durableReceipt: CommandVerifiedBatchReceipt | null;
    phase: 'arming';
};

type CommittedSectionRenderRetryAdmission =
    | { status: 'ineligible' }
    | { status: 'stale' }
    | { status: 'requires-proof' }
    | { status: 'proof-mismatch' }
    | { durableReceipt: CommandVerifiedBatchReceipt; status: 'admitted' };

type ParsedApprovedRetryBatch = {
    commands: ValidApprovedCommandBatch['commands'];
    commandsById: ReadonlyMap<string, ApprovedCommand>;
    envelope: ValidApprovedCommandBatch;
};

type WarnedRenderPayloadBinding = {
    approvedCommand: ApprovedCommand;
    renderAction: ApprovedRenderAction;
};

function isEligible(confirmation: PendingAppActionConfirmation): boolean {
    return (
        (confirmation.status === 'executed' || confirmation.status === 'failed') &&
        confirmation.followUpStatus === 'retryable' &&
        confirmation.followUpProjectRevision !== null
    );
}

function hasExpectedCommandBatch(
    expected: ApprovedCommandBatch,
    candidate: PendingAppActionConfirmation['approvalSnapshot']['commandBatch']
): boolean {
    return (
        candidate !== undefined &&
        candidate.serialized === expected.serialized &&
        hasExactAgentCommandBatchAuthority(expected.authority, candidate.authority)
    );
}

function parseApprovedBatch(confirmation: PendingAppActionConfirmation): ParsedApprovedRetryBatch | null {
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!approvedCommandBatch) {
        return null;
    }
    const parsedBatch = parseVersionedCommandBatchEnvelope(
        approvedCommandBatch.serialized,
        approvedCommandBatch.authority
    );
    if (parsedBatch.status !== 'valid') {
        return null;
    }
    return {
        commands: parsedBatch.envelope.commands,
        commandsById: new Map(parsedBatch.envelope.commands.map((command) => [command.commandId, command])),
        envelope: parsedBatch.envelope,
    };
}

function hasExactCommittedCommands(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch
): boolean {
    if (confirmation.executedActions.length !== approvedBatch.commands.length) {
        return false;
    }
    const committedCommandIds = new Set<string>();
    for (const execution of confirmation.executedActions) {
        if (!execution.commandId) {
            return false;
        }
        const approvedCommand = approvedBatch.commandsById.get(execution.commandId);
        if (
            !approvedCommand ||
            committedCommandIds.has(approvedCommand.commandId) ||
            execution.actionType !== approvedCommand.operation ||
            execution.commandSchemaVersion !== approvedCommand.schemaVersion ||
            execution.executionKind !== 'project' ||
            (execution.outcome !== 'committed' && execution.outcome !== 'committed-with-warning')
        ) {
            return false;
        }
        committedCommandIds.add(approvedCommand.commandId);
    }
    return true;
}

function getWarnedRenderBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch
): WarnedRenderPayloadBinding | null {
    const approvedRenderCommands = approvedBatch.commands.filter(
        (command) => command.operation === 'renderProjectSections'
    );
    const renderActions = confirmation.approvalSnapshot.actions.filter(
        (action) => action.type === 'renderProjectSections'
    );
    if (approvedRenderCommands.length !== 1 || renderActions.length !== 1) {
        return null;
    }
    const approvedCommand = approvedRenderCommands[0];
    const renderAction = renderActions[0];
    if (!approvedCommand || !renderAction || !renderAction.payload.jobs) {
        return null;
    }
    const warnedExecutions = confirmation.executedActions.filter(
        (execution) =>
            execution.commandId === approvedCommand.commandId &&
            execution.actionType === approvedCommand.operation &&
            execution.executionKind === 'project' &&
            execution.outcome === 'committed-with-warning'
    );
    if (warnedExecutions.length !== 1) {
        return null;
    }
    const actionHash = getExactAgentActionHash({ operation: renderAction.type, arguments: renderAction.payload });
    const commandHash = getExactAgentActionHash({
        operation: approvedCommand.operation,
        arguments: approvedCommand.arguments,
    });
    return actionHash === commandHash ? { approvedCommand, renderAction } : null;
}

function hasExactDurableReceipt(
    receipt: CommandVerifiedBatchReceipt | null,
    binding: WarnedRenderPayloadBinding
): receipt is CommandVerifiedBatchReceipt {
    if (
        !receipt ||
        receipt.outcome !== 'partially-committed' ||
        receipt.atomicity !== 'durable-atomic-with-non-atomic-effects'
    ) {
        return false;
    }
    const renderOutcomes = receipt.commandOutcomes.filter(
        ({ commandId, operation }) =>
            commandId === binding.approvedCommand.commandId && operation === binding.approvedCommand.operation
    );
    if (renderOutcomes.length !== 1 || renderOutcomes[0]?.outcome !== 'committed') {
        return false;
    }
    if (receipt.pendingEffects.length !== 1) {
        return false;
    }
    const pendingEffect = receipt.pendingEffects[0];
    return (
        pendingEffect?.commandId === binding.approvedCommand.commandId &&
        pendingEffect.operation === binding.approvedCommand.operation &&
        pendingEffect.kind === 'external-effect' &&
        pendingEffect.remediation === 'reconcile' &&
        pendingEffect.state === 'pending'
    );
}

function hasExactFinalizedReceipt(
    receipt: CommandVerifiedBatchReceipt | null,
    binding: WarnedRenderPayloadBinding
): receipt is CommandVerifiedBatchReceipt {
    if (
        !receipt ||
        receipt.outcome !== 'committed' ||
        receipt.atomicity !== 'atomic' ||
        receipt.pendingEffects.length > 0
    ) {
        return false;
    }
    const renderOutcomes = receipt.commandOutcomes.filter(
        ({ commandId, operation }) =>
            commandId === binding.approvedCommand.commandId && operation === binding.approvedCommand.operation
    );
    return renderOutcomes.length === 1 && renderOutcomes[0]?.outcome === 'committed';
}

function hasExactBatchBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch,
    receipt: CommandVerifiedBatchReceipt
): boolean {
    return (
        approvedBatch.envelope.runId === confirmation.runId &&
        receipt.runId === confirmation.runId &&
        approvedBatch.envelope.batchId === confirmation.groupId &&
        receipt.batchId === confirmation.groupId &&
        approvedBatch.envelope.baseRevision === confirmation.projectRevision
    );
}

function getReceiptIdentity(receipt: CommandVerifiedBatchReceipt): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function hasExactContinuationEffects(
    continuationEffects: readonly AgentRunPendingEffect[],
    receiptEffects: readonly AgentRunPendingEffect[]
): boolean {
    return (
        continuationEffects.length === receiptEffects.length &&
        continuationEffects.every((effect, index) => {
            const receiptEffect = receiptEffects[index];
            return (
                receiptEffect !== undefined &&
                effect.commandId === receiptEffect.commandId &&
                effect.kind === receiptEffect.kind &&
                effect.operation === receiptEffect.operation &&
                effect.reason === receiptEffect.reason &&
                effect.remediation === receiptEffect.remediation &&
                effect.state === receiptEffect.state
            );
        })
    );
}

function hasExactTrackedRunBinding(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt
): boolean {
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!approvedCommandBatch) {
        return false;
    }
    const trackedRun = agentRunLifecycle.get(confirmation.runId);
    if (!trackedRun || trackedRun.revisions.committed !== confirmation.followUpProjectRevision) {
        return false;
    }
    const receiptIdentity = getReceiptIdentity(receipt);
    const matchingReceipts = trackedRun.receipts.filter(({ workId }) => workId === receipt.batchId);
    if (matchingReceipts.length !== 1 || matchingReceipts[0]?.receiptIdentity !== receiptIdentity) {
        return false;
    }
    const matchingContinuations = trackedRun.pendingEffectContinuations.filter(
        ({ batchId }) => batchId === receipt.batchId
    );
    const continuation = matchingContinuations[0];
    return (
        matchingContinuations.length === 1 &&
        continuation?.receiptIdentity === receiptIdentity &&
        continuation.recovery === 'reconcile-batch' &&
        continuation.serializedBatch === approvedCommandBatch.serialized &&
        hasExactAgentCommandBatchAuthority(approvedCommandBatch.authority, continuation.authority) &&
        hasExactContinuationEffects(continuation.effects, receipt.pendingEffects)
    );
}

function hasExactFinalizedContinuationBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch,
    binding: WarnedRenderPayloadBinding,
    finalizedReceipt: CommandVerifiedBatchReceipt
): boolean {
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!approvedCommandBatch) {
        return false;
    }
    const trackedRun = agentRunLifecycle.get(confirmation.runId);
    if (!trackedRun || trackedRun.revisions.committed !== confirmation.followUpProjectRevision) {
        return false;
    }
    const matchingContinuations = trackedRun.pendingEffectContinuations.filter(
        ({ batchId }) => batchId === confirmation.groupId
    );
    const continuation = matchingContinuations[0];
    const finalizedReceiptIdentity = getReceiptIdentity(finalizedReceipt);
    if (matchingContinuations.length === 0) {
        const matchingReceipts = trackedRun.receipts.filter(({ workId }) => workId === confirmation.groupId);
        const matchingCommittedWork = trackedRun.committedWork.filter(({ workId }) => workId === confirmation.groupId);
        const matchingBatches = trackedRun.batches.filter(({ batchId }) => batchId === confirmation.groupId);
        const matchingSagaSteps = trackedRun.saga.steps.filter(
            (step) => step.owner === 'external-effect' && step.workId === confirmation.groupId
        );
        return (
            matchingReceipts.length === 1 &&
            matchingReceipts[0]?.receiptIdentity === finalizedReceiptIdentity &&
            matchingCommittedWork.length === 1 &&
            matchingCommittedWork[0]?.receiptIdentity === finalizedReceiptIdentity &&
            matchingBatches.length === 1 &&
            matchingBatches[0]?.status === 'committed' &&
            matchingBatches[0].receiptIdentity === finalizedReceiptIdentity &&
            matchingBatches[0].commandIds.length === approvedBatch.commands.length &&
            matchingBatches[0].commandIds.every(
                (commandId, index) => commandId === approvedBatch.commands[index]?.commandId
            ) &&
            matchingSagaSteps.length === 1 &&
            matchingSagaSteps[0]?.stepId === `effect:${confirmation.groupId}:${binding.approvedCommand.commandId}` &&
            matchingSagaSteps[0]?.state === 'committed' &&
            matchingSagaSteps[0].receiptIdentity === finalizedReceiptIdentity
        );
    }
    if (
        matchingContinuations.length !== 1 ||
        !continuation ||
        continuation.recovery !== 'reconcile-batch' ||
        continuation.serializedBatch !== approvedCommandBatch.serialized ||
        !hasExactAgentCommandBatchAuthority(approvedCommandBatch.authority, continuation.authority)
    ) {
        return false;
    }
    const pendingReceiptIdentity = `${finalizedReceipt.schemaVersion}:${finalizedReceipt.runId}:${finalizedReceipt.batchId}:partially-committed`;
    const matchingReceipts = trackedRun.receipts.filter(({ workId }) => workId === confirmation.groupId);
    const matchingCommittedWork = trackedRun.committedWork.filter(({ workId }) => workId === confirmation.groupId);
    const matchingBatches = trackedRun.batches.filter(({ batchId }) => batchId === confirmation.groupId);
    const matchingSagaSteps = trackedRun.saga.steps.filter(
        (step) => step.owner === 'external-effect' && step.workId === confirmation.groupId
    );
    const pendingEffect = continuation.effects[0];
    return (
        matchingReceipts.length === 1 &&
        matchingReceipts[0]?.receiptIdentity === pendingReceiptIdentity &&
        matchingCommittedWork.length === 1 &&
        matchingCommittedWork[0]?.receiptIdentity === pendingReceiptIdentity &&
        matchingBatches.length === 1 &&
        matchingBatches[0]?.status === 'committed' &&
        matchingBatches[0].receiptIdentity === pendingReceiptIdentity &&
        matchingBatches[0].commandIds.length === approvedBatch.commands.length &&
        matchingBatches[0].commandIds.every(
            (commandId, index) => commandId === approvedBatch.commands[index]?.commandId
        ) &&
        matchingSagaSteps.length === 1 &&
        matchingSagaSteps[0]?.stepId === `effect:${confirmation.groupId}:${binding.approvedCommand.commandId}` &&
        matchingSagaSteps[0]?.state === 'external-pending' &&
        matchingSagaSteps[0].receiptIdentity === pendingReceiptIdentity &&
        continuation.receiptIdentity === pendingReceiptIdentity &&
        continuation.effects.length === 1 &&
        pendingEffect?.commandId === binding.approvedCommand.commandId &&
        pendingEffect.operation === binding.approvedCommand.operation &&
        pendingEffect.kind === 'external-effect' &&
        pendingEffect.remediation === 'reconcile' &&
        pendingEffect.state === 'pending' &&
        approvedBatch.envelope.batchId === continuation.batchId
    );
}

export function admitCommittedSectionRenderRetry(
    input: ArmingInput | EligibilityInput | ProofInput
): CommittedSectionRenderRetryAdmission {
    if (
        input.phase !== 'arming' &&
        input.expectedCommandBatch &&
        !hasExpectedCommandBatch(input.expectedCommandBatch, input.confirmation.approvalSnapshot.commandBatch)
    ) {
        return { status: 'stale' };
    }
    if (input.phase !== 'arming' && !isEligible(input.confirmation)) {
        return { status: 'ineligible' };
    }
    if (input.phase === 'eligibility') {
        return { status: 'requires-proof' };
    }

    const approvedBatch = parseApprovedBatch(input.confirmation);
    if (!approvedBatch || !hasExactCommittedCommands(input.confirmation, approvedBatch)) {
        return { status: 'proof-mismatch' };
    }
    const renderBinding = getWarnedRenderBinding(input.confirmation, approvedBatch);
    if (!renderBinding) {
        return { status: 'proof-mismatch' };
    }
    const durableReceipt = input.durableReceipt;
    if (!durableReceipt) {
        return { status: 'proof-mismatch' };
    }
    const hasPendingReceipt = hasExactDurableReceipt(durableReceipt, renderBinding);
    const hasFinalizedReceipt = hasExactFinalizedReceipt(durableReceipt, renderBinding);
    if (!hasPendingReceipt && !hasFinalizedReceipt) {
        return { status: 'proof-mismatch' };
    }
    if (input.phase === 'arming') {
        return hasPendingReceipt ? { durableReceipt, status: 'admitted' } : { status: 'proof-mismatch' };
    }
    if (
        !hasExactBatchBinding(input.confirmation, approvedBatch, durableReceipt) ||
        (hasPendingReceipt
            ? !hasExactTrackedRunBinding(input.confirmation, durableReceipt)
            : !hasExactFinalizedContinuationBinding(input.confirmation, approvedBatch, renderBinding, durableReceipt))
    ) {
        return { status: 'proof-mismatch' };
    }
    return { durableReceipt, status: 'admitted' };
}
