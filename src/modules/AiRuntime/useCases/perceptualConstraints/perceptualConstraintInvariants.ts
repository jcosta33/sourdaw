import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { type PerceptualConstraint } from '../../models/PerceptualConstraint';
import { type MetricGoal, type ObjectiveMetricId } from '../metricGoalContractTypes';
import { OBJECTIVE_METRIC_LABELS, OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';

type InvariantMetric = { metricId: ObjectiveMetricId; band: string | null; tolerance: number };
type Criterion = MetricGoalEvaluation['criteria'][number];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;

/**
 * Half a decibel in a band holding between a tenth and nine tenths of the energy moves its share by
 * about a point, and 0.5 dB is the smallest level change listeners reliably detect (the level JND).
 */
const BAND_SHARE_TOLERANCE = 0.01;
/** A side share of one point below 120 Hz is side 20 dB under mid, which still reads as a mono low end. */
const LOW_SIDE_SHARE_TOLERANCE = 0.01;
/** The level JND: 0.5 dB is the smallest level change listeners reliably detect on program material. */
const LEVEL_TOLERANCE_DB = 0.5;
/** The estimate is a difference of two levels, each read at the 0.5 dB level JND. */
const DYNAMIC_RANGE_TOLERANCE_DB = 1;

/**
 * What each constraint measures. The low end is the measurement's own `sub` and `bass` bands, the
 * spectrum below its 250 Hz low-mid boundary, plus its side share below the bass-mono crossover. An
 * intimate vocal is the recipe catalog's own reading of intimacy, a forward level with held dynamics;
 * the space no metric measures is excluded as an edit dimension instead.
 */
export const PERCEPTUAL_CONSTRAINT_INVARIANTS: Readonly<
    Record<PerceptualConstraint['constraintId'], readonly InvariantMetric[]>
> = {
    'low-end-untouched-v1': [
        { metricId: 'frequencyBandEnergy', band: 'sub', tolerance: BAND_SHARE_TOLERANCE },
        { metricId: 'frequencyBandEnergy', band: 'bass', tolerance: BAND_SHARE_TOLERANCE },
        { metricId: 'lowFrequencyStereoContent', band: null, tolerance: LOW_SIDE_SHARE_TOLERANCE },
    ],
    'vocal-intimacy-v1': [
        { metricId: 'dynamicRangeEstimate', band: null, tolerance: DYNAMIC_RANGE_TOLERANCE_DB },
        { metricId: 'rms', band: null, tolerance: LEVEL_TOLERANCE_DB },
    ],
};

/** A constraint goal is accepted only in the exact shape its versioned invariant states. */
export function perceptualConstraintCriterionMatches(goal: MetricGoal): boolean {
    const source = goal.source;
    if (source.kind !== 'constraint') {
        return true;
    }
    if (goal.referenceTargetIds.length > 0 || goal.targetValue !== null || goal.stepId !== 'overall') {
        return false;
    }
    if (source.constraintId === 'unsupported') {
        return goal.relation === 'unsupported' && goal.metricId === null;
    }
    return (
        goal.relation === 'hold' &&
        goal.targetIds.length === 1 &&
        PERCEPTUAL_CONSTRAINT_INVARIANTS[source.constraintId].some(
            (metric) =>
                metric.metricId === goal.metricId && metric.band === goal.band && metric.tolerance === goal.tolerance
        )
    );
}

function figure(value: number | undefined): string {
    return value === undefined ? 'unavailable' : String(Math.round(value * 1000) / 1000);
}

/** The refusal the user sees for a constraint goal: the clause, and for a measured one the metric and figures. */
export function describePerceptualConstraintFailure(
    criterion: Criterion,
    failure: Failure,
    nameOf: (targetId: string) => string
): string {
    if (criterion.source.kind !== 'constraint') {
        throw new TypeError('Only a constraint criterion has a constraint failure.');
    }
    const clause = criterion.source.clause;
    if (criterion.metricId === null || criterion.source.constraintId === 'unsupported') {
        return `The request says “${clause}”, and no measurement the application takes can show that it holds, so this batch cannot be approved. State it as a protected track or control instead.`;
    }
    const metricId = criterion.metricId;
    const metric = Object.entries(OBJECTIVE_METRIC_LABELS).find(([id]) => id === metricId)?.[1] ?? metricId;
    const unit = Object.entries(OBJECTIVE_METRIC_UNITS).find(([id]) => id === metricId)?.[1] ?? '';
    const subject = `${metric}${criterion.band === null ? '' : ` (${criterion.band} band)`} on ${criterion.targetIds.map(nameOf).join(', ')}`;
    if (failure === 'out-of-tolerance') {
        return `The preview breaks “${clause}”: ${subject} moved from ${figure(criterion.baseline[0])} to ${figure(criterion.observed[0])} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
    }
    return `“${clause}” is unverified: no compatible baseline and preview measurement of ${subject} exists for this batch. Re-preview to measure it.`;
}
