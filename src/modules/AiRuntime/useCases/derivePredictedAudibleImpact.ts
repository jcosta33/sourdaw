import {
    MAX_AUDIBLE_CLAIM_METRICS,
    type AgentRunAudiblePrediction,
    type AgentRunAudiblePredictionOutcome,
    type AgentRunObservedAudibleImpact,
    type AgentRunPlanAudibleImpact,
} from '../models/AgentRun';
import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { boundMeasurement, type DeriveMeasuredAudibleImpactInput } from './boundAudibleMeasurement';
import { AUDIBLE_CLAIM_TOO_LARGE_REASON, UNBOUND_PREDICTION_REASON } from './deriveMeasuredAudibleImpact';
import { evaluateMetricGoalAdmission } from './evaluateMetricGoalAdmission';

import type { MetricGoal, MetricGoalState } from './metricGoalContractTypes';

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
        range: goal.range,
        relation: goal.relation,
        targetValue: goal.targetValue,
        tolerance: goal.tolerance,
        source: structuredClone(goal.source),
        outcome,
    };
}

function observedOf(measurement: ReturnType<typeof boundMeasurement>): AgentRunObservedAudibleImpact {
    const metrics = measurement?.metrics ?? [];
    if (metrics.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return { status: 'omitted', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON };
    }
    return { status: 'listed', metrics };
}

export type PredictedEvidence = DeriveMeasuredAudibleImpactInput & {
    commandBatch: Parameters<typeof evaluateMetricGoalAdmission>[0]['commandBatch'];
};

function evaluateBoundBatch(
    state: MetricGoalState,
    evidence: PredictedEvidence | undefined,
    measurement: ReturnType<typeof boundMeasurement>
) {
    if (evidence === undefined || measurement === null) {
        return null;
    }
    return evaluateMetricGoalAdmission({ state, commandBatch: evidence.commandBatch });
}

function verificationOf(evaluation: ReturnType<typeof evaluateBoundBatch>) {
    if (evaluation === null) {
        return null;
    }
    return {
        status: evaluation.status === 'verified' ? ('verified' as const) : ('blocked' as const),
        failure: evaluation.failure,
        reason: evaluation.reason,
    };
}

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
    const evaluation = evaluateBoundBatch(state, evidence, measurement);
    const predictions: AgentRunAudiblePrediction[] = [];
    for (const [index, { goal, kind }] of goals.entries()) {
        if (kind !== 'perceptual' && kind !== 'comparative') {
            continue;
        }
        predictions.push(predictionOf(goal, evaluation === null ? null : outcomeOf(evaluation.criteria[index])));
    }
    return {
        status: 'predicted',
        kind: predicted.some(({ kind }) => kind === 'comparative') ? 'comparative' : 'perceptual',
        revision: state.binding.revision,
        batchContentHash: state.binding.contentHash,
        predictions,
        verification: verificationOf(evaluation),
        observed: observedOf(measurement),
    };
}
