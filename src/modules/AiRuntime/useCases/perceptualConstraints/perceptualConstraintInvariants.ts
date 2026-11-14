import { type PerceptualConstraint } from '../../models/PerceptualConstraint';
import { type MetricGoal, type ObjectiveMetricId } from '../metricGoalContractTypes';
import { METRIC_HOLD_TOLERANCES } from '../metricHoldTolerances';

/**
 * `hold` keeps a metric within its tolerance either way; a bound lets it move freely one way and by at
 * most its tolerance the other, so "don't make it louder" admits a quieter preview.
 */
export type InvariantRelation = 'hold' | 'no-increase' | 'no-decrease';

type InvariantMetric = {
    metricId: ObjectiveMetricId;
    band: string | null;
    relation: InvariantRelation;
    tolerance: number;
};

/** A bound's tolerance is its metric's hold tolerance, so the two can never disagree. */
function toleranceOf(metricId: ObjectiveMetricId): number {
    const entry = METRIC_HOLD_TOLERANCES[metricId];
    if (entry === undefined) {
        throw new TypeError(`${metricId} has no versioned hold tolerance.`);
    }
    return entry.value;
}

const BAND_SHARE_TOLERANCE = toleranceOf('frequencyBandEnergy');
const LOW_SIDE_SHARE_TOLERANCE = toleranceOf('lowFrequencyStereoContent');
const LEVEL_TOLERANCE_DB = toleranceOf('rms');
const DYNAMIC_RANGE_TOLERANCE_DB = toleranceOf('dynamicRangeEstimate');
const LOUDNESS_TOLERANCE_LU = toleranceOf('integratedLoudness');
const CREST_FACTOR_TOLERANCE_DB = toleranceOf('crestFactor');
const SIDE_SHARE_TOLERANCE = toleranceOf('sideEnergyFraction');
const CENTROID_TOLERANCE_HZ = toleranceOf('spectralCentroid');

/**
 * What each constraint measures. The low end is the measurement's own `sub` and `bass` bands, the
 * spectrum below its 250 Hz low-mid boundary, plus its side share below the bass-mono crossover. An
 * intimate vocal is the recipe catalog's own reading of intimacy, a forward level with held dynamics;
 * the space no metric measures is excluded as an edit dimension instead. Loudness is the mix's or the
 * track's integrated loudness, stereo width its side share, dynamics its crest factor and brightness
 * its spectral centroid, each over the whole arrangement.
 */
export const PERCEPTUAL_CONSTRAINT_INVARIANTS: Readonly<
    Record<PerceptualConstraint['constraintId'], readonly InvariantMetric[]>
> = {
    'low-end-untouched-v1': [
        { metricId: 'frequencyBandEnergy', band: 'sub', relation: 'hold', tolerance: BAND_SHARE_TOLERANCE },
        { metricId: 'frequencyBandEnergy', band: 'bass', relation: 'hold', tolerance: BAND_SHARE_TOLERANCE },
        { metricId: 'lowFrequencyStereoContent', band: null, relation: 'hold', tolerance: LOW_SIDE_SHARE_TOLERANCE },
    ],
    'vocal-intimacy-v1': [
        { metricId: 'dynamicRangeEstimate', band: null, relation: 'hold', tolerance: DYNAMIC_RANGE_TOLERANCE_DB },
        { metricId: 'rms', band: null, relation: 'hold', tolerance: LEVEL_TOLERANCE_DB },
    ],
    'loudness-held-v1': [
        { metricId: 'integratedLoudness', band: null, relation: 'hold', tolerance: LOUDNESS_TOLERANCE_LU },
    ],
    'loudness-not-raised-v1': [
        { metricId: 'integratedLoudness', band: null, relation: 'no-increase', tolerance: LOUDNESS_TOLERANCE_LU },
    ],
    'loudness-not-lowered-v1': [
        { metricId: 'integratedLoudness', band: null, relation: 'no-decrease', tolerance: LOUDNESS_TOLERANCE_LU },
    ],
    'stereo-width-held-v1': [
        { metricId: 'sideEnergyFraction', band: null, relation: 'hold', tolerance: SIDE_SHARE_TOLERANCE },
    ],
    'dynamics-held-v1': [
        { metricId: 'crestFactor', band: null, relation: 'hold', tolerance: CREST_FACTOR_TOLERANCE_DB },
    ],
    'brightness-held-v1': [
        { metricId: 'spectralCentroid', band: null, relation: 'hold', tolerance: CENTROID_TOLERANCE_HZ },
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
        goal.targetIds.length === 1 &&
        PERCEPTUAL_CONSTRAINT_INVARIANTS[source.constraintId].some(
            (metric) =>
                metric.metricId === goal.metricId &&
                metric.band === goal.band &&
                metric.relation === goal.relation &&
                metric.tolerance === goal.tolerance
        )
    );
}
