import { type parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type AgentRunPlanBoundRefusal } from '../stores/readAgentRunPlanBoundRefusal';

import { agentRunLifecycle } from './agentRunLifecycle';
import { type compileAgentActionExecution } from './compileAgentActionExecution';

type CompiledAuthority = ReturnType<typeof compileAgentActionExecution>['commandBatch']['authority'];
type ParsedEnvelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];

/**
 * Records the plan of the one batch a Prompt Bar request compiled, or returns the refusal naming the
 * plan collection it would carry past its bound, in which case nothing is written.
 */
export function recordPromptBarRunPlan(input: {
    runId: string;
    actionLabels: readonly string[];
    metricGoalState: string | undefined;
    receipts: ApplicationToolReceipt[] | undefined;
    envelope: ParsedEnvelope;
    authority: CompiledAuthority;
    revision: string;
}): AgentRunPlanBoundRefusal | null {
    const run = agentRunLifecycle.get(input.runId);
    if (!run) {
        throw new Error('Admitted prompt run disappeared before command planning.');
    }
    const { authority } = input;
    const record = {
        runId: input.runId,
        summary: input.actionLabels.join('\n'),
        metricGoalState: input.metricGoalState,
        applicationToolReceipts: input.receipts ?? [],
        commandIds: input.envelope.commands.map((command) => command.commandId),
        serializedBatchIdentity: input.envelope.idempotencyKey,
        revision: input.revision,
        scope: {
            targetIds: [...authority.scope.targetIds],
            targetRanges: authority.scope.targetRanges.map(({ startBeat, endBeat }) => ({ startBeat, endBeat })),
            protectedTargetIds: [...authority.scope.protectedTargetIds],
            protectedRanges: authority.scope.protectedRanges.map(({ startBeat, endBeat }) => ({ startBeat, endBeat })),
        },
        grants: {
            ...authority.grants,
            allowedOperationPrefixes: [...authority.grants.allowedOperationPrefixes],
        },
        budgets: run.budgets,
    };
    const refusal = agentRunLifecycle.admitPlan(record);
    if (refusal === null) {
        agentRunLifecycle.recordPlan(record);
    }
    return refusal;
}
