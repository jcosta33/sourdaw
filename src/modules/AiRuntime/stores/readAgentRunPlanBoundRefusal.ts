import { type AgentRunPlan } from '../models/AgentRun';
import { APPLICATION_TOOL_RECEIPT_MAX_BYTES, measureApplicationToolReceiptBytes } from '../models/ApplicationOwnedTool';

import { MAX_COLLECTION_LENGTH, MAX_PLAN_APPLICATION_TOOL_RECEIPTS, MAX_PLAN_CAPABILITIES } from './agentRunStore';

export type AgentRunPlanBoundedCollection =
    | 'commandIds'
    | 'applicationToolReceipts'
    | 'interpretedConstraints'
    | 'scope.targetIds'
    | 'scope.targetRanges'
    | 'scope.protectedTargetIds'
    | 'scope.protectedRanges'
    | 'steps'
    | 'expectedImpact.project'
    | 'capabilities'
    | 'risks'
    | 'approvalPoints'
    | 'validationStrategy'
    | 'stoppingConditions'
    | 'alternatives';

/**
 * A plan the persistent schema would not read back: a collection holding more entries than its
 * bound, or a receipt larger than the per-call bound. Writing it would lose the whole run on restore.
 */
export type AgentRunPlanBoundRefusal = {
    status: 'refused';
    reason: 'collection-bound' | 'receipt-bytes';
    collection: AgentRunPlanBoundedCollection;
    bound: number;
};

type BoundedCollection = { collection: AgentRunPlanBoundedCollection; length: number; bound: number };

function collection(
    name: AgentRunPlanBoundedCollection,
    entries: readonly unknown[],
    bound = MAX_COLLECTION_LENGTH
): BoundedCollection {
    return { collection: name, length: entries.length, bound };
}

function listBoundedCollections(plan: AgentRunPlan): BoundedCollection[] {
    return [
        collection('commandIds', plan.commandIds),
        collection('applicationToolReceipts', plan.applicationToolReceipts ?? [], MAX_PLAN_APPLICATION_TOOL_RECEIPTS),
        collection('interpretedConstraints', plan.interpretedConstraints),
        collection('scope.targetIds', plan.scope.targetIds),
        collection('scope.targetRanges', plan.scope.targetRanges),
        collection('scope.protectedTargetIds', plan.scope.protectedTargetIds),
        collection('scope.protectedRanges', plan.scope.protectedRanges),
        collection('steps', plan.steps),
        collection('expectedImpact.project', plan.expectedImpact.project),
        collection('capabilities', plan.capabilities, MAX_PLAN_CAPABILITIES),
        collection('risks', plan.risks),
        collection('approvalPoints', plan.approvalPoints),
        collection('validationStrategy', plan.validationStrategy),
        collection('stoppingConditions', plan.stoppingConditions),
        collection('alternatives', plan.alternatives),
    ];
}

/** Checks a plan against the bounds `sanitizeAgentRunState` reads it back under; `null` admits it. */
export function readAgentRunPlanBoundRefusal(plan: AgentRunPlan): AgentRunPlanBoundRefusal | null {
    const overfull = listBoundedCollections(plan).find((entry) => entry.length > entry.bound);
    if (overfull !== undefined) {
        return {
            status: 'refused',
            reason: 'collection-bound',
            collection: overfull.collection,
            bound: overfull.bound,
        };
    }
    const oversized = (plan.applicationToolReceipts ?? []).some(
        (receipt) => measureApplicationToolReceiptBytes(receipt) > APPLICATION_TOOL_RECEIPT_MAX_BYTES
    );
    if (oversized) {
        return {
            status: 'refused',
            reason: 'receipt-bytes',
            collection: 'applicationToolReceipts',
            bound: APPLICATION_TOOL_RECEIPT_MAX_BYTES,
        };
    }
    return null;
}
