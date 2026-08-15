import { compileVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';

import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';
import { getAgentExecutionModeFailure } from './getAgentExecutionModeFailure';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CompileAgentActionExecutionInput = Omit<
    Parameters<typeof compilePlannedActionCommandBatch>[0],
    'autoCommit' | 'mode'
> & {
    mode?: AgentExecutionMode;
    requiresConfirmation: boolean;
    trustCeiling?: AgentTrustCeiling;
};

export function compileAgentActionExecution(input: CompileAgentActionExecutionInput) {
    const { mode = 'apply', requiresConfirmation, trustCeiling = 'destructive-commit', ...commandInput } = input;
    if (mode === 'explain' || mode === 'plan') {
        throw new Error(`Agent execution mode ${mode} does not produce an executable command batch`);
    }
    const proposed = compilePlannedActionCommandBatch({
        ...commandInput,
        autoCommit: false,
        mode: mode === 'preview' ? 'preview' : 'commit',
    });
    const agentApproval = compileAgentRiskApproval({
        commandBatch: proposed.commandBatch,
        requireExplicitApproval: requiresConfirmation,
    });
    const authorityFailure = getAgentExecutionModeFailure({
        mode,
        operation: mode === 'preview' ? 'preview' : 'commit',
        requiredTrustMode: agentApproval.policy.requiredTrustMode,
        trustCeiling,
    });
    if (authorityFailure) {
        throw new Error(authorityFailure);
    }

    if (mode === 'preview') {
        return {
            ...proposed,
            agentApproval,
            interactionMode: mode,
            requiresConfirmation: false as const,
        };
    }

    if (agentApproval.policy.decision === 'confirm') {
        return {
            ...proposed,
            agentApproval,
            interactionMode: mode,
            requiresConfirmation: true as const,
        };
    }

    const parsed = parseVersionedCommandBatchEnvelope(
        proposed.commandBatch.serialized,
        proposed.commandBatch.authority
    );
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const envelope = parsed.envelope;
    const commandBatch = compileVersionedCommandBatchEnvelope({
        autoCommit: true,
        autoCommitApproval: () => {
            const approvalValidation = validateAgentRiskApproval({
                approval: agentApproval,
                commandBatch: proposed.commandBatch,
                currentRevision: captureProjectRevision(),
            });
            if (approvalValidation.status === 'invalid') {
                return approvalValidation;
            }
            const currentAuthorityFailure = getAgentExecutionModeFailure({
                mode,
                operation: 'commit',
                requiredTrustMode: agentApproval.policy.requiredTrustMode,
                trustCeiling,
            });
            return currentAuthorityFailure
                ? { status: 'invalid', reason: currentAuthorityFailure }
                : { status: 'valid' };
        },
        baseRevision: envelope.baseRevision,
        batchId: envelope.batchId,
        batchLocalBindings: envelope.batchLocalBindings,
        commands: proposed.commandEnvelopes,
        dynamicEffects: envelope.dynamicEffects,
        idempotencyKey: envelope.idempotencyKey,
        intent: envelope.intent,
        mode: envelope.mode,
        projectId: envelope.projectId,
        protectedRanges: envelope.scope.protectedRanges,
        protectedTargetIds: envelope.scope.protectedTargetIds,
        runId: envelope.runId,
    });
    return {
        commandBatch,
        commandEnvelopes: proposed.commandEnvelopes,
        agentApproval: null,
        interactionMode: mode,
        requiresConfirmation: false as const,
    };
}
