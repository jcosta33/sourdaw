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
    function keys(
        entry: Record<string, unknown>,
        required: readonly string[],
        optional: readonly string[] = []
    ): boolean {
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
            !entry.editDimensions.every((dimension) =>
                ['processing', 'midi-content', 'arrangement'].includes(dimension)
            ) ||
            !Array.isArray(entry.prohibitions) ||
            !Array.isArray(entry.creationSlots)
        )
            return false;
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
        if (!record(entry)) return false;
        if (entry.kind === 'unsupported') return keys(entry, ['kind']);
        if (entry.kind === 'recipe')
            return (
                keys(entry, ['kind', 'recipeId', 'catalogVersion', 'recipeDigest', 'expectationIndex']) &&
                text(entry.recipeId) &&
                integer(entry.catalogVersion) &&
                text(entry.recipeDigest) &&
                integer(entry.expectationIndex)
            );
        if (entry.kind === 'request-number')
            return keys(entry, ['kind', 'candidateId', 'token']) && text(entry.candidateId) && text(entry.token);
        return (
            entry.kind === 'policy' &&
            keys(entry, ['kind', 'policyId']) &&
            oneOf(entry.policyId, ['integrated-loudness-match-v1', 'spectral-centroid-comparison-v1'])
        );
    }
    function goal(entry: unknown): entry is MetricGoal {
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
    function authority(entry: unknown): entry is MetricRequestAuthority {
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
            entry.schemaVersion === 1 &&
            text(entry.authorityId) &&
            oneOf(entry.origin, ['complete-literal-parser', 'configured-joint-intake', 'admitted-workflow']) &&
            (entry.callId === null || text(entry.callId)) &&
            (entry.turn === null || integer(entry.turn)) &&
            text(entry.catalogId) &&
            text(entry.requestDigest) &&
            text(entry.revision) &&
            text(entry.projectId) &&
            selection(entry.selection) &&
            oneOf(entry.kind, ['literal', 'perceptual', 'comparative']) &&
            Array.isArray(entry.goals) &&
            entry.goals.every(goal) &&
            (entry.creativeAuthority === null || creative(entry.creativeAuthority)) &&
            (entry.kind !== 'literal' || entry.goals.length === 0) &&
            (entry.origin !== 'configured-joint-intake' ||
                (typeof entry.callId === 'string' && entry.callId.length > 0 && integer(entry.turn) && entry.turn > 0))
        );
    }
    function metricEntry(entry: unknown): boolean {
        if (!record(entry)) return false;
        if (entry.status === 'unavailable') return keys(entry, ['status', 'reason']) && text(entry.reason);
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
    function measurements(entry: unknown): boolean {
        return (
            record(entry) && Object.entries(entry).every(([key, item]) => metricIds.includes(key) && metricEntry(item))
        );
    }
    function artifact(entry: unknown): boolean {
        return (
            record(entry) &&
            oneOf(entry.route, ['mixdown', 'isolated-subgraph']) &&
            record(entry.artifact) &&
            text(entry.artifact.contentAddress)
        );
    }
    function preview(entry: unknown): entry is MeasuredPreview {
        if (
            !record(entry) ||
            !keys(
                entry,
                ['scope', 'range', 'targets', 'batchContentHash', 'revision'],
                ['recipeSource', 'provenance']
            ) ||
            !text(entry.batchContentHash) ||
            !text(entry.revision) ||
            !record(entry.scope) ||
            !oneOf(entry.scope.kind, ['master', 'project', 'tracks', 'buses']) ||
            !range(entry.range) ||
            !Array.isArray(entry.targets)
        )
            return false;
        if ((entry.scope.kind === 'tracks' || entry.scope.kind === 'buses') && !strings(entry.scope.ids)) return false;
        if (
            !entry.targets.every(
                (target: unknown) =>
                    record(target) &&
                    text(target.targetId) &&
                    oneOf(target.targetKind, ['master', 'track', 'bus']) &&
                    measurements(target.baseline) &&
                    measurements(target.preview) &&
                    record(target.deltas) &&
                    Object.values(target.deltas).every(
                        (delta: unknown) =>
                            record(delta) &&
                            ((delta.status === 'compared' && finite(delta.delta) && text(delta.unit)) ||
                                (delta.status === 'incomparable' && text(delta.reason)))
                    )
            )
        )
            return false;
        if (
            entry.recipeSource !== undefined &&
            (!record(entry.recipeSource) ||
                !text(entry.recipeSource.recipeId) ||
                !text(entry.recipeSource.title) ||
                !text(entry.recipeSource.targetId))
        )
            return false;
        const provenance = entry.provenance;
        return (
            record(provenance) &&
            keys(provenance, ['origin', 'callId', 'turn', 'runId', 'targets']) &&
            oneOf(provenance.origin, ['planner', 'approval-preview']) &&
            text(provenance.callId) &&
            integer(provenance.turn) &&
            text(provenance.runId) &&
            Array.isArray(provenance.targets) &&
            provenance.targets.every(
                (target: unknown) =>
                    record(target) && text(target.targetId) && artifact(target.baseline) && artifact(target.preview)
            )
        );
    }
    function proof(entry: unknown): entry is MetricGoalProof {
        return (
            record(entry) &&
            keys(entry, ['preview', 'receiptDigest']) &&
            text(entry.receiptDigest) &&
            preview(entry.preview)
        );
    }
    function state(entry: unknown): entry is MetricGoalState {
        if (
            !record(entry) ||
            !keys(entry, ['schemaVersion', 'authorities', 'steps', 'proofs', 'binding']) ||
            entry.schemaVersion !== 1 ||
            !Array.isArray(entry.authorities) ||
            !entry.authorities.every(authority) ||
            !Array.isArray(entry.steps) ||
            entry.steps.length > MAX_LLM_ACTIONS_PER_BATCH ||
            !Array.isArray(entry.proofs) ||
            !entry.proofs.every(proof) ||
            !entry.steps.every(
                (step: unknown) =>
                    record(step) &&
                    keys(step, ['stepId', 'commandCount', 'operationTypes']) &&
                    text(step.stepId) &&
                    integer(step.commandCount) &&
                    strings(step.operationTypes) &&
                    step.commandCount === step.operationTypes.length
            )
        )
            return false;
        const binding = entry.binding;
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
    return state(value) ? structuredClone(value) : null;
}
