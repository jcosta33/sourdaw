import { type MetricGoal, type ObjectiveMetricId } from './metricGoalContractTypes';
import { OBJECTIVE_METRIC_UNITS } from './objectiveMetricProjection';

/**
 * How far a held metric may move and still count as held. `toleranceId` names the value: changing
 * `value` takes a new id, so a goal frozen under the old one never silently means the new one.
 */
export type MetricHoldTolerance = {
    readonly toleranceId: string;
    readonly unit: string;
    readonly value: number;
};

/**
 * Every measured hold, whether a recipe promises it or a request's constraint states it, is judged
 * against the entry of its metric here and nowhere else. Measured figures carry rounding, and a
 * filter's leakage moves a mono figure off exactly zero, so a hold is never zero; the reason for
 * each value sits beside it.
 */
export const METRIC_HOLD_TOLERANCES: Readonly<Partial<Record<ObjectiveMetricId, MetricHoldTolerance>>> = {
    /**
     * Half a decibel in a band holding between a tenth and nine tenths of the energy moves its share by
     * about a point, and 0.5 dB is the smallest level change listeners reliably detect (the level JND).
     */
    frequencyBandEnergy: { toleranceId: 'frequency-band-energy-hold-v1', unit: 'ratio', value: 0.01 },
    /** A side share of one point below 120 Hz is side 20 dB under mid, which still reads as a mono low end. */
    lowFrequencyStereoContent: { toleranceId: 'low-frequency-stereo-content-hold-v1', unit: 'ratio', value: 0.01 },
    /** The level JND: 0.5 dB is the smallest level change listeners reliably detect on program material. */
    rms: { toleranceId: 'rms-hold-v1', unit: 'dBFS', value: 0.5 },
    /** The estimate is a difference of two levels, each read at the 0.5 dB level JND. */
    dynamicRangeEstimate: { toleranceId: 'dynamic-range-estimate-hold-v1', unit: 'dB', value: 1 },
    /**
     * Loudness matching compares A/B within the 0.5 dB level JND, and EBU R 128 (2014) permits a ±0.5 LU
     * deviation from its target. R 128's tighter ±0.2 LU since 2020 is a meter-error allowance for
     * quality control, which a deterministic offline render of the same project does not have.
     */
    integratedLoudness: { toleranceId: 'integrated-loudness-hold-v1', unit: 'LUFS', value: 0.5 },
    /** Crest factor is a peak level minus an RMS level, each read at the 0.5 dB level JND. */
    crestFactor: { toleranceId: 'crest-factor-hold-v1', unit: 'dB', value: 1 },
    /**
     * Half a decibel of side relative to mid moves the side share by about a point for any share between
     * a tenth and nine tenths, as for a band share; a near-mono source, under a tenth, is held more loosely.
     */
    sideEnergyFraction: { toleranceId: 'side-energy-fraction-hold-v1', unit: 'ratio', value: 0.01 },
    /**
     * Listening tests found a centroid change of about 16% the smallest reliably discriminated on natural
     * instrument tones (Horner lab, "Effect of Spectral Centroid Manipulation on Discrimination and
     * Identification of Instrument Timbres"). 50 Hz is that fraction of a 300 Hz centroid, a bass track's,
     * and a far smaller fraction of a mix's kHz-range centroid, so the hold is no looser than audible for
     * any source above 300 Hz; it compares absolute figures, so it is stricter on bright sources by design.
     */
    spectralCentroid: { toleranceId: 'spectral-centroid-hold-v1', unit: 'hertz', value: 50 },
    /**
     * The figure is the detector's onset count over the render's own duration, so it moves only when the
     * detector gains or loses an onset. 0.25 onsets per second is one hit gained or lost every two bars of
     * 4/4 at 120 BPM, about 6% of an eighth-note pattern (4/s) and 3% of sixteenths (8/s): a rarer change is
     * a borderline attack crossing the detector threshold, a more frequent one is an audible change in the
     * rhythm.
     */
    transientDensity: { toleranceId: 'transient-density-hold-v1', unit: 'per-second', value: 0.25 },
};

/** The versioned hold tolerance of a metric, or `null` when none is stated, so no hold on it can be admitted. */
function readMetricHoldTolerance(metricId: ObjectiveMetricId): MetricHoldTolerance | null {
    return METRIC_HOLD_TOLERANCES[metricId] ?? null;
}

type RecipeExpectationTolerance = { status: 'read'; tolerance: number } | { status: 'missing' };

/**
 * The tolerance a recipe expectation compiles with: a hold takes its metric's versioned tolerance, a
 * movement goal keeps zero because it is judged by its direction alone. A hold on a metric with no entry
 * is `missing`, never zero.
 */
export function readRecipeExpectationTolerance(
    metricId: ObjectiveMetricId,
    relation: MetricGoal['relation']
): RecipeExpectationTolerance {
    if (relation !== 'hold') {
        return { status: 'read', tolerance: 0 };
    }
    const entry = readMetricHoldTolerance(metricId);
    if (entry === null || entry.unit !== OBJECTIVE_METRIC_UNITS[metricId]) {
        return { status: 'missing' };
    }
    return { status: 'read', tolerance: entry.value };
}
