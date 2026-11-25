import { type AgentRunPlan, type AgentRunScope } from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

/** The plan a write records when its caller supplies none: the batch and receipts, bound to one revision. */
export function createLegacyAgentRunPlan(input: {
    summary: string;
    commandIds: string[];
    serializedBatchIdentity: string | null;
    applicationToolReceipts: ApplicationToolReceipt[];
    revision: string;
    scope: AgentRunScope;
}): AgentRunPlan {
    return {
        summary: input.summary,
        commandIds: [...input.commandIds],
        serializedBatchIdentity: input.serializedBatchIdentity,
        applicationToolReceipts: structuredClone(input.applicationToolReceipts),
        revision: input.revision,
        classification: 'simple',
        showPlanPanel: false,
        objective: input.summary,
        interpretedConstraints: [`Plan is bound to project revision ${input.revision}.`],
        scope: structuredClone(input.scope),
        steps: [],
        expectedImpact: {
            project: [],
            audible: {
                status: 'not-claimed',
                reason: 'No audible result is claimed by a persisted legacy plan.',
            },
        },
        capabilities: [],
        risks: [],
        approvalPoints: [],
        validationStrategy: ['Revalidate the persisted project revision before resuming.'],
        stoppingConditions: ['Stop if the persisted project revision is no longer current.'],
        alternatives: [],
        needsUserDecision: false,
    } satisfies AgentRunPlan;
}
