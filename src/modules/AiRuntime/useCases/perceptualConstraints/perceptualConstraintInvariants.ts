import { type PerceptualConstraint } from '../../models/PerceptualConstraint';
import { type MetricGoal, type ObjectiveMetricId } from '../metricGoalContractTypes';

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
 * Loudness matching compares A/B within the 0.5 dB level JND, and EBU R 128 (2014) permits a ±0.5 LU
 * deviation from its target. R 128's tighter ±0.2 LU since 2020 is a meter-error allowance for
 * quality control, which a deterministic offline render of the same project does not have.
 */
const LOUDNESS_TOLERANCE_LU = 0.5;
/** Crest factor is a peak level minus an RMS level, each read at the 0.5 dB level JND. */
const CREST_FACTOR_TOLERANCE_DB = 1;
/**
 * Half a decibel of side relative to mid moves the side share by about a point for any share between
 * a tenth and nine tenths, as for a band share; a near-mono source, under a tenth, is held more loosely.
 */
const SIDE_SHARE_TOLERANCE = 0.01;
/**
 * Listening tests found a centroid change of about 16% the smallest reliably discriminated on natural
 * instrument tones (Horner lab, "Effect of Spectral Centroid Manipulation on Discrimination and
 * Identification of Instrument Timbres"). 50 Hz is that fraction of a 300 Hz centroid, a bass track's,
 * and a far smaller fraction of a mix's kHz-range centroid, so the hold is no looser than audible for
 * any source above 300 Hz; it compares absolute figures, so it is stricter on bright sources by design.
 */
const CENTROID_TOLERANCE_HZ = 50;

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
