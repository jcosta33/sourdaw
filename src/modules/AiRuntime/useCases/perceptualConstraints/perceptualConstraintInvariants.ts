import { type PerceptualConstraint } from '../../models/PerceptualConstraint';
import { type MetricGoal, type ObjectiveMetricId } from '../metricGoalContractTypes';

type InvariantMetric = { metricId: ObjectiveMetricId; band: string | null; tolerance: number };

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
