import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    MAX_METRIC_GOAL_STATE_BYTES,
    type MetricGoalProof,
    type MetricGoalSource,
} from '../models/MetricGoalAdmission';

import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from './metricGoalContractTypes';

function oneOf(entry: unknown, values: readonly string[]): entry is string {
    return typeof entry === 'string' && values.includes(entry);
}

function record(entry: unknown): entry is Record<string, unknown> {
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry);
}

function text(entry: unknown): entry is string {
    return typeof entry === 'string' && entry.length <= 8192;
}

function finite(entry: unknown): entry is number {
    return typeof entry === 'number' && Number.isFinite(entry);
}

function integer(entry: unknown): entry is number {
    return finite(entry) && Number.isSafeInteger(entry) && entry >= 0;
}

function strings(entry: unknown): entry is string[] {
    return (
        Array.isArray(entry) &&
        entry.length <= MAX_METRIC_GOAL_STATE_BYTES &&
        entry.every((item: unknown) => text(item))
    );
}

function keys(entry: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
    return (
        required.every((key) => Object.hasOwn(entry, key)) &&
        Object.keys(entry).every((key) => required.includes(key) || optional.includes(key))
    );
}

function range(entry: unknown): boolean {
    return (
        record(entry) &&
        keys(entry, ['startBeat', 'endBeat', 'sectionId']) &&
        finite(entry.startBeat) &&
        finite(entry.endBeat) &&
        entry.startBeat >= 0 &&
        entry.endBeat > entry.startBeat &&
        (entry.sectionId === null || text(entry.sectionId))
    );
}

function selection(entry: unknown): boolean {
    return (
        record(entry) &&
        keys(entry, ['trackId', 'clipId', 'clipIds', 'activeView']) &&
        (entry.trackId === null || text(entry.trackId)) &&
        (entry.clipId === null || text(entry.clipId)) &&
        strings(entry.clipIds) &&
        oneOf(entry.activeView, ['arrange', 'automation', 'clip', 'mix'])
    );
}

function creative(entry: unknown): entry is CreativeRequestAuthority {
    if (
        !record(entry) ||
        entry.schemaVersion !== 1 ||
        !text(entry.authorityId) ||
        !text(entry.catalogId) ||
        !text(entry.requestDigest) ||
        !text(entry.revision) ||
        !selection(entry.selection) ||
        !oneOf(entry.mode, ['edit', 'create', 'read-only']) ||
        !oneOf(entry.uncertainty, ['none', 'artistic']) ||
        !Array.isArray(entry.targets) ||
        !strings(entry.editDimensions) ||
        !entry.editDimensions.every((dimension) => ['processing', 'midi-content', 'arrangement'].includes(dimension)) ||
        !Array.isArray(entry.prohibitions) ||
        !Array.isArray(entry.creationSlots)
    ) {
        return false;
    }
    return (
        entry.targets.every(
            (target: unknown) =>
                record(target) &&
                oneOf(target.provenance, ['explicit-reference', 'contextual-selection', 'new-object-slot']) &&
                oneOf(target.objectType, ['track', 'clip', 'clip-set']) &&
                strings(target.objectIds) &&
                (target.parentTrackId === null || text(target.parentTrackId))
        ) &&
        entry.prohibitions.every(
            (prohibition: unknown) =>
                record(prohibition) &&
                ((prohibition.kind === 'protect-object' && text(prohibition.objectId)) ||
                    (prohibition.kind === 'exclude-dimension' &&
                        oneOf(prohibition.dimension, ['processing', 'midi-content', 'arrangement'])))
        ) &&
        entry.creationSlots.every(
            (slot: unknown) =>
                record(slot) &&
                oneOf(slot.objectType, ['track', 'clip', 'notes', 'device']) &&
                (slot.parentObjectId === null || text(slot.parentObjectId)) &&
                (slot.parentCreatedObjectType === undefined || slot.parentCreatedObjectType === 'track') &&
                integer(slot.budget)
        )
    );
}

function source(entry: unknown): entry is MetricGoalSource {
    if (!record(entry)) {
        return false;
    }
    if (entry.kind === 'unsupported') {
        return keys(entry, ['kind']);
    }
    if (entry.kind === 'recipe') {
        return (
            keys(entry, ['kind', 'recipeId', 'catalogVersion', 'recipeDigest', 'expectationIndex']) &&
            text(entry.recipeId) &&
            integer(entry.catalogVersion) &&
            text(entry.recipeDigest) &&
            integer(entry.expectationIndex)
        );
    }
    if (entry.kind === 'request-number') {
        return keys(entry, ['kind', 'candidateId', 'token']) && text(entry.candidateId) && text(entry.token);
    }
    return (
        entry.kind === 'policy' &&
        keys(entry, ['kind', 'policyId']) &&
        oneOf(entry.policyId, ['integrated-loudness-match-v1', 'spectral-centroid-comparison-v1'])
    );
}

function goal(entry: unknown, metricIds: readonly string[]): entry is MetricGoal {
    return (
        record(entry) &&
        keys(entry, [
            'goalId',
            'stepId',
            'metricId',
            'band',
            'targetIds',
            'referenceTargetIds',
            'range',
            'relation',
            'targetValue',
            'tolerance',
            'source',
        ]) &&
        text(entry.goalId) &&
        text(entry.stepId) &&
        (entry.metricId === null || (typeof entry.metricId === 'string' && metricIds.includes(entry.metricId))) &&
        (entry.band === null || text(entry.band)) &&
        strings(entry.targetIds) &&
        strings(entry.referenceTargetIds) &&
        (entry.range === null || range(entry.range)) &&
        oneOf(entry.relation, [
            'increase',
            'decrease',
            'hold',
            'match-current',
            'greater-than-current',
            'less-than-current',
            'target',
            'unsupported',
        ]) &&
        (entry.targetValue === null || finite(entry.targetValue)) &&
        finite(entry.tolerance) &&
        entry.tolerance >= 0 &&
        source(entry.source)
    );
}

function authorityIdentity(entry: Record<string, unknown>): boolean {
    return (
        entry.schemaVersion === 1 &&
        text(entry.authorityId) &&
        oneOf(entry.origin, ['complete-literal-parser', 'configured-joint-intake', 'admitted-workflow']) &&
        (entry.callId === null || text(entry.callId)) &&
        (entry.turn === null || integer(entry.turn)) &&
        text(entry.catalogId) &&
        text(entry.requestDigest) &&
        text(entry.revision) &&
        text(entry.projectId) &&
        selection(entry.selection)
    );
}

function configuredIntake(entry: Record<string, unknown>): boolean {
    return (
        entry.origin !== 'configured-joint-intake' ||
        (typeof entry.callId === 'string' && entry.callId.length > 0 && integer(entry.turn) && entry.turn > 0)
    );
}

function authority(entry: unknown, metricIds: readonly string[]): entry is MetricRequestAuthority {
    return (
        record(entry) &&
        keys(entry, [
            'schemaVersion',
            'authorityId',
            'origin',
            'callId',
            'turn',
            'catalogId',
            'requestDigest',
            'revision',
            'projectId',
            'selection',
            'kind',
            'goals',
            'creativeAuthority',
        ]) &&
        authorityIdentity(entry) &&
        oneOf(entry.kind, ['literal', 'non-acoustic', 'perceptual', 'comparative']) &&
        Array.isArray(entry.goals) &&
        entry.goals.every((goalEntry: unknown) => goal(goalEntry, metricIds)) &&
        (entry.creativeAuthority === null || creative(entry.creativeAuthority)) &&
        ((entry.kind !== 'literal' && entry.kind !== 'non-acoustic') || entry.goals.length === 0) &&
        (entry.kind !== 'non-acoustic' || entry.creativeAuthority !== null) &&
        configuredIntake(entry)
    );
}

function metricEntry(entry: unknown): boolean {
    if (!record(entry)) {
        return false;
    }
    if (entry.status === 'unavailable') {
        return keys(entry, ['status', 'reason']) && text(entry.reason);
    }
    return (
        keys(entry, ['status', 'metricVersion', 'unit', 'value', 'confidence']) &&
        entry.status === 'measured' &&
        entry.metricVersion === 1 &&
        text(entry.unit) &&
        oneOf(entry.confidence, ['exact', 'estimated']) &&
        (finite(entry.value) ||
            typeof entry.value === 'boolean' ||
            (Array.isArray(entry.value) && entry.value.every((item: unknown) => finite(item))) ||
            (record(entry.value) && Object.values(entry.value).every(finite)))
    );
}

function measurements(entry: unknown, metricIds: readonly string[]): boolean {
    return record(entry) && Object.entries(entry).every(([key, item]) => metricIds.includes(key) && metricEntry(item));
}

function artifact(entry: unknown): boolean {
    return (
        record(entry) &&
        oneOf(entry.route, ['mixdown', 'isolated-subgraph']) &&
        record(entry.artifact) &&
        text(entry.artifact.contentAddress)
    );
}

function previewTarget(target: unknown, metricIds: readonly string[]): boolean {
    return (
        record(target) &&
        text(target.targetId) &&
        oneOf(target.targetKind, ['master', 'track', 'bus']) &&
        measurements(target.baseline, metricIds) &&
        measurements(target.preview, metricIds) &&
        record(target.deltas) &&
        Object.values(target.deltas).every(
            (delta: unknown) =>
                record(delta) &&
                ((delta.status === 'compared' && finite(delta.delta) && text(delta.unit)) ||
                    (delta.status === 'incomparable' && text(delta.reason)))
        )
    );
}

function previewRecipe(entry: unknown): boolean {
    return entry === undefined || (record(entry) && text(entry.recipeId) && text(entry.title) && text(entry.targetId));
}

function previewProvenance(entry: unknown): boolean {
    return (
        record(entry) &&
        keys(entry, ['origin', 'callId', 'turn', 'runId', 'targets']) &&
        oneOf(entry.origin, ['planner', 'approval-preview']) &&
        text(entry.callId) &&
        integer(entry.turn) &&
        text(entry.runId) &&
        Array.isArray(entry.targets) &&
        entry.targets.every(
            (target: unknown) =>
                record(target) && text(target.targetId) && artifact(target.baseline) && artifact(target.preview)
        )
    );
}

function preview(entry: unknown, metricIds: readonly string[]): entry is MeasuredPreview {
    if (
        !record(entry) ||
        !keys(entry, ['scope', 'range', 'targets', 'batchContentHash', 'revision'], ['recipeSource', 'provenance']) ||
        !text(entry.batchContentHash) ||
        !text(entry.revision) ||
        !record(entry.scope) ||
        !oneOf(entry.scope.kind, ['master', 'project', 'tracks', 'buses']) ||
        !range(entry.range) ||
        !Array.isArray(entry.targets)
    ) {
        return false;
    }
    if ((entry.scope.kind === 'tracks' || entry.scope.kind === 'buses') && !strings(entry.scope.ids)) {
        return false;
    }
    return (
        entry.targets.every((target: unknown) => previewTarget(target, metricIds)) &&
        previewRecipe(entry.recipeSource) &&
        previewProvenance(entry.provenance)
    );
}

function proof(entry: unknown, metricIds: readonly string[]): entry is MetricGoalProof {
    return (
        record(entry) &&
        keys(entry, ['preview', 'receiptDigest']) &&
        text(entry.receiptDigest) &&
        preview(entry.preview, metricIds)
    );
}

function logicalStep(step: unknown): boolean {
    return (
        record(step) &&
        keys(step, ['stepId', 'commandCount', 'operationTypes', 'recipePrefixHash']) &&
        text(step.stepId) &&
        integer(step.commandCount) &&
        strings(step.operationTypes) &&
        ((step.stepId === 'overall' && step.recipePrefixHash === null) ||
            (step.stepId.startsWith('recipe:') &&
                typeof step.recipePrefixHash === 'string' &&
                /^[a-f0-9]{64}$/u.test(step.recipePrefixHash))) &&
        step.commandCount === step.operationTypes.length
    );
}

function batchBinding(binding: unknown): boolean {
    return (
        binding === null ||
        (record(binding) &&
            keys(binding, [
                'contentHash',
                'revision',
                'projectId',
                'runId',
                'batchId',
                'schedulePosition',
                'prefixes',
            ]) &&
            text(binding.contentHash) &&
            text(binding.revision) &&
            text(binding.projectId) &&
            text(binding.runId) &&
            text(binding.batchId) &&
            (binding.schedulePosition === null || integer(binding.schedulePosition)) &&
            Array.isArray(binding.prefixes) &&
            binding.prefixes.every(
                (prefix: unknown) =>
                    record(prefix) &&
                    keys(prefix, ['stepId', 'before', 'after']) &&
                    text(prefix.stepId) &&
                    (prefix.before === null || text(prefix.before)) &&
                    text(prefix.after)
            ))
    );
}

function state(entry: unknown, metricIds: readonly string[]): entry is MetricGoalState {
    return (
        record(entry) &&
        keys(
            entry,
            ['schemaVersion', 'authorities', 'steps', 'proofs', 'binding'],
            ['nativeLiteralUses', 'refinedRequests']
        ) &&
        (entry.refinedRequests === undefined || strings(entry.refinedRequests)) &&
        (entry.nativeLiteralUses === undefined ||
            (Array.isArray(entry.nativeLiteralUses) &&
                entry.nativeLiteralUses.length <= MAX_LLM_ACTIONS_PER_BATCH &&
                entry.nativeLiteralUses.every(nativeLiteralUse))) &&
        entry.schemaVersion === 1 &&
        Array.isArray(entry.authorities) &&
        entry.authorities.every((authorityEntry: unknown) => authority(authorityEntry, metricIds)) &&
        Array.isArray(entry.steps) &&
        entry.steps.length <= MAX_LLM_ACTIONS_PER_BATCH &&
        Array.isArray(entry.proofs) &&
        entry.proofs.every((proofEntry: unknown) => proof(proofEntry, metricIds)) &&
        entry.steps.every(logicalStep) &&
        batchBinding(entry.binding)
    );
}

function nativeLiteralUse(entry: unknown): boolean {
    if (
        !record(entry) ||
        !keys(entry, [
            'workflow',
            'field',
            'actionIndex',
            'ownerActionIndex',
            'deviceActionIndex',
            'ownerId',
            'deviceId',
            'deviceType',
            'paramId',
            'unit',
            'value',
            'authorityId',
            'requestDigest',
            'candidateId',
            'token',
            'start',
            'actionHash',
            'ownerActionHash',
            'deviceActionHash',
            'binding',
        ])
    ) {
        return false;
    }
    return (
        entry.workflow === 'backing-vocal-plate' &&
        entry.field === 'highPassHz' &&
        entry.deviceType === 'builtin-filter' &&
        entry.paramId === 'filter-cutoff' &&
        entry.unit === 'Hz' &&
        finite(entry.value) &&
        integer(entry.actionIndex) &&
        integer(entry.ownerActionIndex) &&
        integer(entry.deviceActionIndex) &&
        integer(entry.start) &&
        ['ownerId', 'deviceId', 'authorityId', 'requestDigest', 'candidateId', 'token'].every(
            (key) => text(entry[key]) && entry[key].length > 0
        ) &&
        nativeLiteralBinding(entry.binding)
    );
}

function nativeLiteralBinding(entry: unknown): boolean {
    if (entry === null) {
        return true;
    }
    return (
        record(entry) &&
        keys(entry, [
            'contentHash',
            'projectId',
            'revision',
            'runId',
            'batchId',
            'commandId',
            'ownerCommandId',
            'deviceCommandId',
            'schedulePosition',
        ]) &&
        [
            'contentHash',
            'projectId',
            'revision',
            'runId',
            'batchId',
            'commandId',
            'ownerCommandId',
            'deviceCommandId',
        ].every((key) => text(entry[key]) && entry[key].length > 0) &&
        (entry.schedulePosition === null || integer(entry.schedulePosition))
    );
}

/** Hydration validates source facts, never a persisted permit boolean. Unknown state stays unverified. */
export function metricGoalStateCodec(serialized: string | null | undefined): MetricGoalState | null {
    if (
        typeof serialized !== 'string' ||
        new TextEncoder().encode(serialized).byteLength > MAX_METRIC_GOAL_STATE_BYTES
    ) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return null;
    }
    const metricIds: readonly string[] = getAgentMeasurementMetricIds();
    return state(value, metricIds) ? structuredClone(value) : null;
}
