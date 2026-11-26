import { type AgentRunBatchSchedule, type AgentRunPlan } from '../models/AgentRun';
import {
    MAX_COLLECTION_LENGTH,
    MAX_PLAN_APPLICATION_TOOL_RECEIPTS,
    MAX_PLAN_CAPABILITIES,
} from '../models/AgentRunPlanBounds';
import { APPLICATION_TOOL_RECEIPT_MAX_BYTES, measureApplicationToolReceiptBytes } from '../models/ApplicationOwnedTool';
import { MAX_METRIC_GOAL_STATE_BYTES } from '../models/MetricGoalAdmission';

type AgentRunPlanCollectionName =
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
    | 'alternatives'
    | 'batchSchedule.slices'
    | 'batchSchedule.slices.targetIds'
    | 'batchSchedule.requestProtections.protectedUnchanged'
    | 'batchSchedule.requestProtections.protectedControls'
    | 'batchSchedule.requestProtections.protectedControls.operations'
    | 'batchSchedule.requestProtections.protectedControls.exceptOperations'
    | 'batchSchedule.requestProtections.resolvedTrackClauses';

type AgentRunPlanByteFieldName = 'metricGoalState' | 'batchSchedule.metricGoalState' | 'terminalMeasurementSettlement';

/** A field of the run itself, named `run.` and its path, that the persistent schema reads back under a bound. */
export type AgentRunFieldName = `run.${string}`;

export type AgentRunPlanBoundedCollection = AgentRunPlanCollectionName | AgentRunPlanByteFieldName | AgentRunFieldName;

/**
 * A run the persistent schema would not read back: a collection holding more entries than its
 * bound, a receipt, goal state or settlement larger than its byte bound, or a text longer than its
 * character bound. `collection` names the bounded field. Writing it would lose the whole run, or the field, on restore.
 */
export type AgentRunPlanBoundRefusal = {
    status: 'refused';
    reason: 'collection-bound' | 'receipt-bytes' | 'field-bytes' | 'field-length';
    collection: AgentRunPlanBoundedCollection;
    bound: number;
};

export type BoundedCollection = { collection: AgentRunPlanBoundedCollection; length: number; bound: number };

export function boundedCollection(
    name: AgentRunPlanBoundedCollection,
    entries: readonly unknown[],
    bound = MAX_COLLECTION_LENGTH
): BoundedCollection {
    return { collection: name, length: entries.length, bound };
}

export function readCollectionBoundRefusal(entries: readonly BoundedCollection[]): AgentRunPlanBoundRefusal | null {
    const overfull = entries.find((entry) => entry.length > entry.bound);
    if (overfull === undefined) {
        return null;
    }
    return { status: 'refused', reason: 'collection-bound', collection: overfull.collection, bound: overfull.bound };
}

function listScheduleCollections(schedule: AgentRunBatchSchedule | undefined): BoundedCollection[] {
    if (schedule === undefined) {
        return [];
    }
    const protections = schedule.requestProtections;
    const controls = protections?.facts.protectedControls ?? [];
    return [
        boundedCollection('batchSchedule.slices', schedule.slices),
        ...schedule.slices.map((slice) => boundedCollection('batchSchedule.slices.targetIds', slice.targetIds)),
        boundedCollection(
            'batchSchedule.requestProtections.protectedUnchanged',
            protections?.facts.protectedUnchanged ?? []
        ),
        boundedCollection('batchSchedule.requestProtections.protectedControls', controls),
        ...controls.map((control) =>
            boundedCollection('batchSchedule.requestProtections.protectedControls.operations', control.operations)
        ),
        ...controls.map((control) =>
            boundedCollection(
                'batchSchedule.requestProtections.protectedControls.exceptOperations',
                control.exceptOperations ?? []
            )
        ),
        boundedCollection(
            'batchSchedule.requestProtections.resolvedTrackClauses',
            protections?.resolvedTrackClauses ?? []
        ),
    ];
}

function listBoundedCollections(plan: AgentRunPlan): BoundedCollection[] {
    return [
        boundedCollection('commandIds', plan.commandIds),
        boundedCollection(
            'applicationToolReceipts',
            plan.applicationToolReceipts ?? [],
            MAX_PLAN_APPLICATION_TOOL_RECEIPTS
        ),
        boundedCollection('interpretedConstraints', plan.interpretedConstraints),
        boundedCollection('scope.targetIds', plan.scope.targetIds),
        boundedCollection('scope.targetRanges', plan.scope.targetRanges),
        boundedCollection('scope.protectedTargetIds', plan.scope.protectedTargetIds),
        boundedCollection('scope.protectedRanges', plan.scope.protectedRanges),
        boundedCollection('steps', plan.steps),
        boundedCollection('expectedImpact.project', plan.expectedImpact.project),
        boundedCollection('capabilities', plan.capabilities, MAX_PLAN_CAPABILITIES),
        boundedCollection('risks', plan.risks),
        boundedCollection('approvalPoints', plan.approvalPoints),
        boundedCollection('validationStrategy', plan.validationStrategy),
        boundedCollection('stoppingConditions', plan.stoppingConditions),
        boundedCollection('alternatives', plan.alternatives),
        ...listScheduleCollections(plan.batchSchedule),
    ];
}

type ByteBoundedField = { field: AgentRunPlanByteFieldName; text: string | undefined; bound: number };

function listByteBoundedFields(plan: AgentRunPlan): ByteBoundedField[] {
    return [
        { field: 'metricGoalState', text: plan.metricGoalState, bound: MAX_METRIC_GOAL_STATE_BYTES },
        {
            field: 'batchSchedule.metricGoalState',
            text: plan.batchSchedule?.metricGoalState,
            bound: MAX_METRIC_GOAL_STATE_BYTES,
        },
        {
            field: 'terminalMeasurementSettlement',
            text: plan.terminalMeasurementSettlement,
            bound: APPLICATION_TOOL_RECEIPT_MAX_BYTES,
        },
    ];
}

/** Checks a plan against the bounds `sanitizeAgentRunState` reads it back under; `null` admits it. */
export function readAgentRunPlanBoundRefusal(plan: AgentRunPlan): AgentRunPlanBoundRefusal | null {
    const overfull = readCollectionBoundRefusal(listBoundedCollections(plan));
    if (overfull !== null) {
        return overfull;
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
    const encoder = new TextEncoder();
    const largeField = listByteBoundedFields(plan).find(
        (entry) => entry.text !== undefined && encoder.encode(entry.text).byteLength > entry.bound
    );
    if (largeField === undefined) {
        return null;
    }
    return { status: 'refused', reason: 'field-bytes', collection: largeField.field, bound: largeField.bound };
}
