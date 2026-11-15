import {
    AGENT_RUN_MAX_TEXT_LENGTH,
    MAX_AUDIBLE_CLAIM_METRICS,
    MAX_AUDIBLE_PREDICTIONS,
    type AgentRunAudiblePrediction,
    type AgentRunAudiblePredictionOutcome,
    type AgentRunAudibleVerification,
    type AgentRunMeasuredAudibleMetric,
    type AgentRunMeasuredFigure,
    type AgentRunObservedAudibleImpact,
    type AgentRunPlanAudibleImpact,
} from '../models/AgentRun';
import { type MetricGoal, type MetricGoalEvaluation } from '../models/MetricGoalAdmission';
import { PERCEPTUAL_CONSTRAINT_IDS } from '../models/PerceptualConstraint';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= AGENT_RUN_MAX_TEXT_LENGTH ? value : null;
}

function readFigure(value: unknown): AgentRunMeasuredFigure | null {
    if (!isRecord(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        return null;
    }
    const unit = readText(value.unit);
    return unit === null ? null : { value: value.value, unit };
}

function readRange(value: unknown): AgentRunMeasuredAudibleMetric['range'] | null {
    if (!isRecord(value) || typeof value.startBeat !== 'number' || typeof value.endBeat !== 'number') {
        return null;
    }
    if (!Number.isFinite(value.startBeat) || !Number.isFinite(value.endBeat)) {
        return null;
    }
    if (value.sectionId === null) {
        return { startBeat: value.startBeat, endBeat: value.endBeat, sectionId: null };
    }
    const sectionId = readText(value.sectionId);
    return sectionId === null ? null : { startBeat: value.startBeat, endBeat: value.endBeat, sectionId };
}

function readMetric(value: unknown): AgentRunMeasuredAudibleMetric | null {
    if (!isRecord(value)) {
        return null;
    }
    const targetId = readText(value.targetId);
    const targetKind =
        value.targetKind === 'master' || value.targetKind === 'track' || value.targetKind === 'bus'
            ? value.targetKind
            : null;
    const metricId = readText(value.metricId);
    const range = readRange(value.range);
    const baseline = readFigure(value.baseline);
    const preview = readFigure(value.preview);
    const delta = readFigure(value.delta);
    if (
        targetId === null ||
        targetKind === null ||
        range === null ||
        metricId === null ||
        baseline === null ||
        preview === null ||
        delta === null
    ) {
        return null;
    }
    return { targetId, targetKind, range, metricId, baseline, preview, delta };
}

function readMetrics(value: unknown): AgentRunMeasuredAudibleMetric[] | null {
    if (!Array.isArray(value) || value.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return null;
    }
    const metrics: AgentRunMeasuredAudibleMetric[] = [];
    for (const candidate of value) {
        const metric = readMetric(candidate);
        if (metric === null) {
            return null;
        }
        metrics.push(metric);
    }
    return metrics;
}

type Relation = MetricGoal<string>['relation'];
type Source = MetricGoal<string>['source'];
type PolicyId = Extract<Source, { kind: 'policy' }>['policyId'];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;

// Records keep each list exhaustive against its type: a new member fails to compile until it is read here.
const RELATIONS: Record<Relation, true> = {
    increase: true,
    decrease: true,
    hold: true,
    'no-increase': true,
    'no-decrease': true,
    'match-current': true,
    'greater-than-current': true,
    'less-than-current': true,
    target: true,
    unsupported: true,
};
const POLICY_IDS: Record<PolicyId, true> = {
    'integrated-loudness-match-v1': true,
    'spectral-centroid-comparison-v1': true,
    'integrated-loudness-comparison-v1': true,
    'side-energy-fraction-comparison-v1': true,
    'crest-factor-comparison-v1': true,
};
const FAILURES: Record<Failure, true> = {
    missing: true,
    incomparable: true,
    contradictory: true,
    stale: true,
    'out-of-tolerance': true,
};

function isRelation(value: unknown): value is Relation {
    return typeof value === 'string' && Object.hasOwn(RELATIONS, value);
}

function isPolicyId(value: unknown): value is PolicyId {
    return typeof value === 'string' && Object.hasOwn(POLICY_IDS, value);
}

function isFailure(value: unknown): value is Failure {
    return typeof value === 'string' && Object.hasOwn(FAILURES, value);
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNullableText(value: unknown): string | null | undefined {
    return value === null ? null : (readText(value) ?? undefined);
}

function readList<Item>(value: unknown, readItem: (candidate: unknown) => Item | null): Item[] | null {
    if (!Array.isArray(value) || value.length > MAX_AUDIBLE_PREDICTIONS) {
        return null;
    }
    const items: Item[] = [];
    for (const candidate of value) {
        const item = readItem(candidate);
        if (item === null) {
            return null;
        }
        items.push(item);
    }
    return items;
}

function readSource(value: unknown): Source | null {
    if (!isRecord(value)) {
        return null;
    }
    if (value.kind === 'unsupported') {
        return { kind: 'unsupported' };
    }
    if (value.kind === 'recipe') {
        const recipeId = readText(value.recipeId);
        const recipeDigest = readText(value.recipeDigest);
        const catalogVersion = readFiniteNumber(value.catalogVersion);
        const expectationIndex = readFiniteNumber(value.expectationIndex);
        return recipeId === null ||
            recipeDigest === null ||
            catalogVersion === null ||
            expectationIndex === null ||
            !Number.isSafeInteger(expectationIndex) ||
            expectationIndex < 0
            ? null
            : { kind: 'recipe', recipeId, catalogVersion, recipeDigest, expectationIndex };
    }
    if (value.kind === 'request-number') {
        const candidateId = readText(value.candidateId);
        const token = readText(value.token);
        return candidateId === null || token === null ? null : { kind: 'request-number', candidateId, token };
    }
    if (value.kind === 'policy') {
        return isPolicyId(value.policyId) ? { kind: 'policy', policyId: value.policyId } : null;
    }
    if (value.kind === 'constraint') {
        const constraintId = PERCEPTUAL_CONSTRAINT_IDS.find((id) => id === value.constraintId);
        const clause = readText(value.clause);
        return constraintId === undefined || clause === null ? null : { kind: 'constraint', constraintId, clause };
    }
    return null;
}

function readOutcome(value: unknown): AgentRunAudiblePredictionOutcome | null {
    if (!isRecord(value) || (value.status !== 'verified' && value.status !== 'blocked')) {
        return null;
    }
    const readNumbers = (candidate: unknown) => readList(candidate, readFiniteNumber);
    const baseline = readNumbers(value.baseline);
    const observed = readNumbers(value.observed);
    const reference = readNumbers(value.reference);
    const unit = readNullableText(value.unit);
    if (baseline === null || observed === null || reference === null || unit === undefined) {
        return null;
    }
    return { baseline, observed, reference, unit, status: value.status };
}

function readPredictionSubject(value: Record<string, unknown>) {
    const goalId = readText(value.goalId);
    const stepId = readText(value.stepId);
    const metricId = readNullableText(value.metricId);
    const band = readNullableText(value.band);
    const readIds = (candidate: unknown) => readList(candidate, (id) => readText(id));
    const targetIds = readIds(value.targetIds);
    const referenceTargetIds = readIds(value.referenceTargetIds);
    const range = value.range === null ? null : readRange(value.range);
    if (
        goalId === null ||
        stepId === null ||
        metricId === undefined ||
        band === undefined ||
        targetIds === null ||
        referenceTargetIds === null ||
        (range === null && value.range !== null)
    ) {
        return null;
    }
    return { goalId, stepId, metricId, band, targetIds, referenceTargetIds, range };
}

function readPredictionCriterion(value: Record<string, unknown>) {
    const relation = isRelation(value.relation) ? value.relation : null;
    const targetValue = value.targetValue === null ? null : readFiniteNumber(value.targetValue);
    const tolerance = readFiniteNumber(value.tolerance);
    const source = readSource(value.source);
    const outcome = value.outcome === null ? null : readOutcome(value.outcome);
    if (
        relation === null ||
        (targetValue === null && value.targetValue !== null) ||
        tolerance === null ||
        source === null ||
        (outcome === null && value.outcome !== null)
    ) {
        return null;
    }
    return { relation, targetValue, tolerance, source, outcome };
}

function readPrediction(value: unknown): AgentRunAudiblePrediction | null {
    if (!isRecord(value)) {
        return null;
    }
    const subject = readPredictionSubject(value);
    const criterion = readPredictionCriterion(value);
    return subject === null || criterion === null ? null : { ...subject, ...criterion };
}

function readVerification(value: unknown): AgentRunAudibleVerification | null {
    if (!isRecord(value) || (value.status !== 'verified' && value.status !== 'blocked')) {
        return null;
    }
    const failure = isFailure(value.failure) ? value.failure : null;
    const reason = readNullableText(value.reason);
    if ((failure === null && value.failure !== null) || reason === undefined) {
        return null;
    }
    return { status: value.status, failure, reason };
}

function readObserved(value: unknown): AgentRunObservedAudibleImpact | null {
    if (!isRecord(value)) {
        return null;
    }
    if (value.status === 'omitted') {
        const reason = readText(value.reason);
        return reason === null ? null : { status: 'omitted', reason };
    }
    const metrics = value.status === 'listed' ? readMetrics(value.metrics) : null;
    return metrics === null ? null : { status: 'listed', metrics };
}

/**
 * A verdict and the outcomes it rests on come together: no verdict without a figure read for every
 * prediction, a verified verdict only with every outcome verified, and a blocked one only with a failure.
 */
function isCoherentVerification(
    verification: AgentRunAudibleVerification | null,
    predictions: readonly AgentRunAudiblePrediction[]
): boolean {
    if (verification === null) {
        return predictions.every((prediction) => prediction.outcome === null);
    }
    if (verification.status === 'blocked') {
        return verification.failure !== null && predictions.every((prediction) => prediction.outcome !== null);
    }
    return (
        verification.failure === null && predictions.every((prediction) => prediction.outcome?.status === 'verified')
    );
}

function readPredictedImpact(value: Record<string, unknown>): AgentRunPlanAudibleImpact | null {
    const kind = value.kind === 'perceptual' || value.kind === 'comparative' ? value.kind : null;
    const revision = readText(value.revision);
    const batchContentHash = readText(value.batchContentHash);
    const predictions = readList(value.predictions, readPrediction);
    const verification = value.verification === null ? null : readVerification(value.verification);
    const observed = readObserved(value.observed);
    if (
        kind === null ||
        revision === null ||
        batchContentHash === null ||
        predictions === null ||
        predictions.length === 0 ||
        (verification === null && value.verification !== null) ||
        observed === null ||
        !isCoherentVerification(verification, predictions)
    ) {
        return null;
    }
    return { status: 'predicted', kind, revision, batchContentHash, predictions, verification, observed };
}

/**
 * A plan claims nothing audible, the measured figures of one batch, or the predictions of its frozen
 * metric goals with their verification; any other shape is malformed.
 */
export function readAgentRunAudibleImpact(value: Record<string, unknown>): AgentRunPlanAudibleImpact | null {
    if (value.status === 'not-claimed') {
        const reason = readText(value.reason);
        return reason === null ? null : { status: 'not-claimed', reason };
    }
    if (value.status === 'predicted') {
        return readPredictedImpact(value);
    }
    if (value.status !== 'measured') {
        return null;
    }
    const revision = readText(value.revision);
    const batchContentHash = readText(value.batchContentHash);
    const metrics = readMetrics(value.metrics);
    if (revision === null || batchContentHash === null || metrics === null) {
        return null;
    }
    return { status: 'measured', revision, batchContentHash, metrics };
}
