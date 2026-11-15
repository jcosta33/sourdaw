import {
    MAX_AUDIBLE_CLAIM_METRICS,
    type AgentRunAudiblePrediction,
    type AgentRunAudiblePredictionOutcome,
    type AgentRunMeasuredAudibleMetric,
    type AgentRunObservedAudibleImpact,
    type AgentRunPlanAudibleImpact,
} from '../models/AgentRun';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { bindMeasuredPreviewToBatch } from './bindMeasuredPreviewToBatch';
import { evaluateMetricGoalAdmission } from './evaluateMetricGoalAdmission';
import {
    OBJECTIVE_METRIC_CHANGE_UNITS,
    OBJECTIVE_METRIC_UNITS,
    objectiveMetricProjection,
} from './objectiveMetricProjection';

import type { MetricGoal, MetricGoalState, ObjectiveMetricId } from './metricGoalContractTypes';

export const AUDIBLE_CLAIM_TOO_LARGE_REASON =
    'The measurement moved more figures than a plan can list; the card shows them.';

export const NO_AUDIBLE_CLAIM_REASON =
    'The application plans state changes but does not infer or claim that it listened to audio.';

export const UNBOUND_PREDICTION_REASON =
    'The request states perceptual or comparative goals, but no command batch is bound to them yet, so nothing is predicted.';

type DeriveMeasuredAudibleImpactInput = {
    envelope: Parameters<typeof bindMeasuredPreviewToBatch>[1];
    /** The preview the approval card carries, already bound to the persisted batch or absent. */
    snapshotPreview: MeasuredPreview | undefined;
    /** Every preview the metric-goal proofs hold, in the order the proofs were recorded. */
    proofPreviews: readonly MeasuredPreview[];
};

function isObjectiveMetricId(metricId: string): metricId is ObjectiveMetricId {
    return Object.hasOwn(OBJECTIVE_METRIC_UNITS, metricId);
}

type MeasuredEntry = { key: string; metric: AgentRunMeasuredAudibleMetric | null };

/**
 * Every compared or incomparable entry a preview measured, keyed by target, metric and range. An
 * entry that did not move, cannot be compared or has a figure or change in another unit than its
 * metric definition fixes carries no metric, but still counts as that measurement's answer.
 */
function measuredEntries(preview: MeasuredPreview): MeasuredEntry[] {
    const { startBeat, endBeat, sectionId } = preview.range;
    const range = { startBeat, endBeat, sectionId };
    return preview.targets.flatMap((target) =>
        Object.entries(target.deltas).flatMap(([metricId, delta]): MeasuredEntry[] => {
            if (delta === undefined || !isObjectiveMetricId(metricId)) {
                return [];
            }
            const key = [target.targetId, metricId, startBeat, endBeat, sectionId ?? ''].join('\u0000');
            const baseline = objectiveMetricProjection(metricId, target.baseline[metricId]);
            const previewed = objectiveMetricProjection(metricId, target.preview[metricId]);
            if (
                delta.status !== 'compared' ||
                delta.delta === 0 ||
                baseline === null ||
                previewed === null ||
                delta.unit !== OBJECTIVE_METRIC_CHANGE_UNITS[metricId]
            ) {
                return [{ key, metric: null }];
            }
            return [
                {
                    key,
                    metric: {
                        targetId: target.targetId,
                        targetKind: target.targetKind,
                        range,
                        metricId,
                        baseline,
                        preview: previewed,
                        delta: { value: delta.delta, unit: delta.unit },
                    },
                },
            ];
        })
    );
}

function movedMetrics(preview: MeasuredPreview): AgentRunMeasuredAudibleMetric[] {
    return measuredEntries(preview).flatMap((entry) => (entry.metric === null ? [] : [entry.metric]));
}

/** The preview a claim is bound to and the metrics it lists, from the card's own preview or else the bound proofs. */
function boundMeasurement(
    input: DeriveMeasuredAudibleImpactInput
): { preview: MeasuredPreview; metrics: AgentRunMeasuredAudibleMetric[] } | null {
    const snapshot = bindMeasuredPreviewToBatch(input.snapshotPreview, input.envelope);
    if (snapshot !== undefined) {
        return { preview: snapshot, metrics: movedMetrics(snapshot) };
    }
    const boundProofs = input.proofPreviews.flatMap((preview) => {
        const bound = bindMeasuredPreviewToBatch(preview, input.envelope);
        return bound === undefined ? [] : [bound];
    });
    const latestProof = boundProofs.at(-1);
    return latestProof === undefined ? null : { preview: latestProof, metrics: mergeProofMetrics(boundProofs) };
}

/**
 * The latest bound proof's answer for each target, metric and range comes first, a held or
 * incomparable answer included, and only then are the metrics that moved kept.
 */
function mergeProofMetrics(proofs: readonly MeasuredPreview[]): AgentRunMeasuredAudibleMetric[] {
    const latest = new Map<string, AgentRunMeasuredAudibleMetric | null>();
    for (const proof of proofs) {
        for (const entry of measuredEntries(proof)) {
            latest.set(entry.key, entry.metric);
        }
    }
    return [...latest.values()].flatMap((metric) => (metric === null ? [] : [metric]));
}

/**
 * The audible claim of one exact batch, listing only metrics whose compared change is not zero. A
 * card whose own preview is bound to the batch claims exactly what that card shows. A card with none
 * (a vibe-run batch) claims what its bound proofs measured, the latest figure of each target and
 * metric. A preview of another batch or revision never contributes, so a claim never describes a
 * change nobody measured.
 */
export function deriveMeasuredAudibleImpact(input: DeriveMeasuredAudibleImpactInput): AgentRunPlanAudibleImpact | null {
    const measurement = boundMeasurement(input);
    if (measurement === null || measurement.metrics.length === 0) {
        return null;
    }
    // Never truncated: a list that leaves figures out would claim less than the card shows as moved.
    if (measurement.metrics.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return { status: 'not-claimed', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON };
    }
    return {
        status: 'measured',
        revision: measurement.preview.revision,
        batchContentHash: measurement.preview.batchContentHash,
        metrics: measurement.metrics,
    };
}

type Criterion = MetricGoalEvaluation['criteria'][number];

/** The figures the evaluation read for a goal; a goal it never reached shows none and is blocked. */
const UNREAD_OUTCOME: AgentRunAudiblePredictionOutcome = {
    baseline: [],
    observed: [],
    reference: [],
    unit: null,
    status: 'blocked',
};

function outcomeOf(criterion: Criterion | undefined): AgentRunAudiblePredictionOutcome {
    const read = criterion ?? UNREAD_OUTCOME;
    return {
        baseline: [...read.baseline],
        observed: [...read.observed],
        reference: [...read.reference],
        unit: read.unit,
        status: read.status,
    };
}

function predictionOf(goal: MetricGoal, outcome: AgentRunAudiblePredictionOutcome | null): AgentRunAudiblePrediction {
    return {
        goalId: goal.goalId,
        stepId: goal.stepId,
        metricId: goal.metricId,
        band: goal.band,
        targetIds: [...goal.targetIds],
        referenceTargetIds: [...goal.referenceTargetIds],
        range: goal.range === null ? null : { ...goal.range },
        relation: goal.relation,
        targetValue: goal.targetValue,
        tolerance: goal.tolerance,
        source: structuredClone(goal.source),
        outcome,
    };
}

function observedOf(measurement: ReturnType<typeof boundMeasurement>): AgentRunObservedAudibleImpact {
    const metrics = measurement?.metrics ?? [];
    return metrics.length > MAX_AUDIBLE_CLAIM_METRICS
        ? { status: 'omitted', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON }
        : { status: 'listed', metrics };
}

type PredictedEvidence = DeriveMeasuredAudibleImpactInput & {
    commandBatch: Parameters<typeof evaluateMetricGoalAdmission>[0]['commandBatch'];
};

/**
 * What the frozen goals of a perceptual or comparative request predict, stated from the goal state's own
 * binding before anything is measured. Given the exact batch with its card preview and proof previews,
 * the same claim also carries the admission's verdict, but only once a measurement bound to that batch
 * exists; a preview of another batch or revision leaves every prediction unverified. Goals of a
 * literal or non-acoustic authority make no prediction. Null when the request states no such goal.
 */
export function derivePredictedAudibleImpact(input: {
    state: MetricGoalState | null | undefined;
    evidence?: PredictedEvidence;
}): AgentRunPlanAudibleImpact | null {
    const { state, evidence } = input;
    if (state === null || state === undefined) {
        return null;
    }
    const goals = state.authorities.flatMap((authority) =>
        authority.goals.map((goal) => ({ goal, kind: authority.kind }))
    );
    const predicted = goals.filter(({ kind }) => kind === 'perceptual' || kind === 'comparative');
    if (predicted.length === 0) {
        return null;
    }
    if (state.binding === null) {
        return { status: 'not-claimed', reason: UNBOUND_PREDICTION_REASON };
    }
    const measurement = evidence === undefined ? null : boundMeasurement(evidence);
    const evaluation =
        evidence === undefined || measurement === null
            ? null
            : evaluateMetricGoalAdmission({ state, commandBatch: evidence.commandBatch });
    return {
        status: 'predicted',
        kind: predicted.some(({ kind }) => kind === 'comparative') ? 'comparative' : 'perceptual',
        revision: state.binding.revision,
        batchContentHash: state.binding.contentHash,
        predictions: goals.flatMap(({ goal, kind }, index) =>
            kind === 'perceptual' || kind === 'comparative'
                ? [predictionOf(goal, evaluation === null ? null : outcomeOf(evaluation.criteria[index]))]
                : []
        ),
        verification:
            evaluation === null
                ? null
                : {
                      status: evaluation.status === 'verified' ? 'verified' : 'blocked',
                      failure: evaluation.failure,
                      reason: evaluation.reason,
                  },
        observed: observedOf(measurement),
    };
}

/**
 * The claim of one persisted batch: its predictions with their verification when the request states
 * perceptual or comparative goals, else the observed-only measured claim, else null.
 */
export function deriveAudibleImpact(
    input: PredictedEvidence & { state: MetricGoalState | null | undefined }
): AgentRunPlanAudibleImpact | null {
    return derivePredictedAudibleImpact({ state: input.state, evidence: input }) ?? deriveMeasuredAudibleImpact(input);
}
