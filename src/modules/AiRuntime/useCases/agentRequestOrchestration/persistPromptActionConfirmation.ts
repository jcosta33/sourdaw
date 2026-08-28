import { updateChatMessage } from '../../stores/chatStore';
import { proposePendingActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { describeAgentRiskApproval } from '../describeAgentRiskApproval';

import type { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

type ConfirmationProposal = Parameters<typeof proposePendingActionConfirmation>[0];
type ParsedCommandBatch = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>;

type PersistPromptActionConfirmationInput = {
    runId: string;
    prompt: string;
    assistantMessageId: string;
    actions: ConfirmationProposal['actions'];
    actionLabels: ConfirmationProposal['actionLabels'];
    commandEnvelopes: NonNullable<ConfirmationProposal['commandEnvelopes']>;
    commandBatch: NonNullable<ConfirmationProposal['commandBatch']>;
    agentApproval: NonNullable<ConfirmationProposal['agentApproval']>;
    affectedIds: NonNullable<ConfirmationProposal['affectedIds']>;
    protectedUnchanged: NonNullable<ConfirmationProposal['protectedUnchanged']>;
    executionMode: ConfirmationProposal['executionMode'];
    group: {
        groupId: string;
        groupLabel: string;
    };
    projectRevision: string;
    parsedCommandBatch: ParsedCommandBatch;
    content: string;
};

export function persistPromptActionConfirmation(input: PersistPromptActionConfirmationInput): void {
    const confirmationId = `prompt-confirmation-${crypto.randomUUID()}`;
    const confirmation = proposePendingActionConfirmation({
        id: confirmationId,
        runId: input.runId,
        prompt: input.prompt,
        assistantMessageId: input.assistantMessageId,
        actions: input.actions,
        actionLabels: input.actionLabels,
        commandEnvelopes: input.commandEnvelopes,
        commandBatch: input.commandBatch,
        agentApproval: input.agentApproval,
        affectedIds: input.affectedIds,
        protectedUnchanged: input.protectedUnchanged,
        risk: {
            level: input.agentApproval.policy.risk,
            reason: input.agentApproval.policy.reasons.join(' ') || null,
        },
        executionMode: input.executionMode,
        groupId: input.group.groupId,
        groupLabel: input.group.groupLabel,
        projectRevision: input.projectRevision,
        resourceLease: createStemImportConfirmationResourceLease(
            input.actions,
            `stem-promotion:${confirmationId}`,
            input.runId
        ),
    });
    if (!confirmation) {
        const reason = 'Prepared action resources exceed the live confirmation limit.';
        agentRunLifecycle.updateBatchStatus({
            runId: input.runId,
            batchId: input.parsedCommandBatch.envelope.batchId,
            status: 'failed',
        });
        agentRunLifecycle.recordError({
            runId: input.runId,
            error: normalizeAgentFailure({
                category: 'budget',
                source: 'command-execution',
                related: {
                    targetIds: [...input.parsedCommandBatch.envelope.scope.targetIds],
                    commandIds: input.parsedCommandBatch.envelope.commands.map((command) => command.commandId),
                    workIds: [input.parsedCommandBatch.envelope.batchId],
                },
                retry: 'never',
                knownDomain: true,
            }),
            terminal: true,
        });
        updateChatMessage(input.assistantMessageId, {
            isStreaming: false,
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content:
                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
        });
        return;
    }

    updateChatMessage(input.assistantMessageId, {
        isStreaming: false,
        pendingActionConfirmationId: confirmationId,
        pendingActionConfirmationStatus: 'proposed',
        content: `${input.content}\n\n${describeAgentRiskApproval(input.agentApproval)}`,
    });
    agentRunLifecycle.transitionPhase({
        runId: input.runId,
        phase: 'waiting-for-approval',
        revision: input.projectRevision,
    });
}
