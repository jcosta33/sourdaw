import { compileVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';

import { bindMetricGoalsToBatch } from './bindMetricGoalsToBatch';
import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';
import { getAgentExecutionModeFailure } from './getAgentExecutionModeFailure';
import { metricGoalStateCodec } from './metricGoalStateCodec';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CompileAgentActionExecutionInput = Omit<
    Parameters<typeof compilePlannedActionCommandBatch>[0],
    'autoCommit' | 'mode'
> & {
    mode?: AgentExecutionMode;
    requiresConfirmation: boolean;
    metricGoalState?: string;
    schedulePosition?: number;
    trustCeiling?: AgentTrustCeiling;
};

function compileAutoCommitAgentBatch(
    proposed: ReturnType<typeof compilePlannedActionCommandBatch>,
    agentApproval: ReturnType<typeof compileAgentRiskApproval>,
    mode: AgentExecutionMode,
    trustCeiling: AgentTrustCeiling
) {
    const parsed = parseVersionedCommandBatchEnvelope(
        proposed.commandBatch.serialized,
        proposed.commandBatch.authority
    );
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const envelope = parsed.envelope;
    return compileVersionedCommandBatchEnvelope({
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
}

export function compileAgentActionExecution(input: CompileAgentActionExecutionInput) {
    const {
        mode = 'apply',
        requiresConfirmation,
        trustCeiling = 'destructive-commit',
        metricGoalState,
        schedulePosition,
        ...commandInput
    } = input;
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
        metricGoalState: JSON.stringify(
            bindMetricGoalsToBatch({
                state: metricGoalStateCodec(metricGoalState),
                commandBatch: proposed.commandBatch,
                schedulePosition,
            })
        ),
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
            metricGoalState: agentApproval.metricGoalState ?? undefined,
            agentApproval,
            allowApproval: null,
            interactionMode: mode,
            requiresConfirmation: false as const,
        };
    }

    if (agentApproval.policy.decision === 'confirm') {
        return {
            ...proposed,
            metricGoalState: agentApproval.metricGoalState ?? undefined,
            agentApproval,
            allowApproval: null,
            interactionMode: mode,
            requiresConfirmation: true as const,
        };
    }

    const commandBatch = compileAutoCommitAgentBatch(proposed, agentApproval, mode, trustCeiling);
    // `agentApproval` keeps its confirmation-flow shape (null without a pending
    // proposal); the compiled allow-path approval is exposed separately through
    // `allowApproval` so only the immediate dispatch sites re-bind it with an
    // observer-capable approval binding, replacing the compile-minted one.
    return {
        commandBatch,
        metricGoalState: agentApproval.metricGoalState ?? undefined,
        commandEnvelopes: proposed.commandEnvelopes,
        agentApproval: null,
        allowApproval: agentApproval,
        interactionMode: mode,
        requiresConfirmation: false as const,
    };
}
