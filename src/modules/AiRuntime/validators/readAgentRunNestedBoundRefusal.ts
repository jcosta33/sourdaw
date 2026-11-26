import { type AgentRun, type AgentRunError, AGENT_RUN_MAX_TEXT_LENGTH } from '../models/AgentRun';
import { AGENT_RUN_MAX_SERIALIZED_LENGTH } from '../models/AgentRunPlanBounds';

import { field, scopeCollections } from './readAgentRunFieldBoundRefusal';
import {
    type AgentRunFieldName,
    type AgentRunPlanBoundRefusal,
    type BoundedCollection,
    boundedCollection,
    readCollectionBoundRefusal,
} from './readAgentRunPlanBoundRefusal';

/** The serialized fields the restore reader keeps up to `AGENT_RUN_MAX_SERIALIZED_LENGTH` characters. */
const SERIALIZED_FIELDS: ReadonlySet<string> = new Set([
    'run.plan.batchSchedule.slices[].serializedSlice',
    'run.plan.batchSchedule.serializedProviderProposal',
    'run.plan.batchSchedule.serializedPlan',
    'run.pendingEffectContinuations[].serializedBatch',
]);

/**
 * Subtrees the restore reader does not read through its text bound: the goal states keep their own
 * byte bound, checked with the plan, and the recorded constraints are read without a length bound.
 */
const UNTEXTED_FIELDS: ReadonlySet<string> = new Set([
    'run.plan.metricGoalState',
    'run.plan.batchSchedule.metricGoalState',
    'run.plan.batchSchedule.recordedConstraints',
]);

function errorCollections(error: AgentRunError): BoundedCollection[] {
    const related = error.related;
    if (related === undefined) {
        return [];
    }
    return [
        boundedCollection(field('errors[].related.targetIds'), related.targetIds),
        boundedCollection(field('errors[].related.commandIds'), related.commandIds),
        boundedCollection(field('errors[].related.workIds'), related.workIds),
        boundedCollection(field('errors[].related.receiptIdentities'), related.receiptIdentities),
        boundedCollection(field('errors[].related.artifactIds'), related.artifactIds),
    ];
}

function continuationCollections(continuation: AgentRun['pendingEffectContinuations'][number]): BoundedCollection[] {
    const { scope, grants } = continuation.authority;
    return [
        boundedCollection(field('pendingEffectContinuations[].effects'), continuation.effects),
        ...scopeCollections('pendingEffectContinuations[].authority.scope', scope),
        boundedCollection(
            field('pendingEffectContinuations[].authority.grants.allowedOperationPrefixes'),
            grants.allowedOperationPrefixes
        ),
    ];
}

function listNestedCollections(run: AgentRun): BoundedCollection[] {
    return [
        ...run.batches.map((batch) => boundedCollection(field('batches[].commandIds'), batch.commandIds)),
        ...run.saga.steps.map((step) =>
            boundedCollection(field('saga.steps[].relatedArtifactIds'), step.relatedArtifactIds)
        ),
        ...run.pendingEffectContinuations.flatMap(continuationCollections),
        ...run.preparedStemImports.map((recovery) =>
            boundedCollection(field('preparedStemImports[].resources'), recovery.resources)
        ),
        ...run.errors.flatMap(errorCollections),
        ...run.providerUsage.map((usage) =>
            boundedCollection(field('providerUsage[].disclosure.categories'), usage.disclosure?.categories ?? [])
        ),
        ...(run.plan?.applicationToolReceipts ?? []).map((receipt) =>
            boundedCollection(field('plan.applicationToolReceipts[].warnings'), receipt.warnings)
        ),
    ];
}

function textRefusal(path: AgentRunFieldName, bound: number): AgentRunPlanBoundRefusal {
    return { status: 'refused', reason: 'field-length', collection: path, bound };
}

/** The first text under `value` longer than the bound the restore reader reads it back under. */
function readOverlongText(value: unknown, path: AgentRunFieldName): AgentRunPlanBoundRefusal | null {
    if (UNTEXTED_FIELDS.has(path)) {
        return null;
    }
    if (typeof value === 'string') {
        const bound = SERIALIZED_FIELDS.has(path) ? AGENT_RUN_MAX_SERIALIZED_LENGTH : AGENT_RUN_MAX_TEXT_LENGTH;
        return value.length > bound ? textRefusal(path, bound) : null;
    }
    if (Array.isArray(value)) {
        return readOverlongEntry(value, `${path}[]`);
    }
    if (typeof value === 'object' && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
            const refusal = readOverlongText(entry, `${path}.${key}`);
            if (refusal !== null) {
                return refusal;
            }
        }
    }
    return null;
}

function readOverlongEntry(entries: readonly unknown[], path: AgentRunFieldName): AgentRunPlanBoundRefusal | null {
    for (const entry of entries) {
        const refusal = readOverlongText(entry, path);
        if (refusal !== null) {
            return refusal;
        }
    }
    return null;
}

function readOverlongField(run: AgentRun): AgentRunPlanBoundRefusal | null {
    for (const [key, entry] of Object.entries(run)) {
        const refusal = readOverlongText(entry, field(key));
        if (refusal !== null) {
            return refusal;
        }
    }
    return null;
}

/**
 * Checks the lists nested inside a run's records, and every text in the run, against the bounds
 * `sanitizeAgentRunState` reads them back under; `null` admits it.
 */
export function readAgentRunNestedBoundRefusal(run: AgentRun): AgentRunPlanBoundRefusal | null {
    return readCollectionBoundRefusal(listNestedCollections(run)) ?? readOverlongField(run);
}
