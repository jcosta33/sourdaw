import { compileVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';

type CompileAgentActionExecutionInput = Omit<Parameters<typeof compilePlannedActionCommandBatch>[0], 'autoCommit'> & {
    requiresConfirmation: boolean;
};

export function compileAgentActionExecution(input: CompileAgentActionExecutionInput) {
    const { requiresConfirmation, ...commandInput } = input;
    const proposed = compilePlannedActionCommandBatch({ ...commandInput, autoCommit: false });
    const agentApproval = compileAgentRiskApproval({
        commandBatch: proposed.commandBatch,
        requireExplicitApproval: requiresConfirmation,
    });

    if (agentApproval.policy.decision === 'confirm') {
        return {
            ...proposed,
            agentApproval,
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
        requiresConfirmation: false as const,
    };
}
