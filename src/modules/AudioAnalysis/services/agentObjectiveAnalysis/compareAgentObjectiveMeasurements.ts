import {
    type AgentObjectiveDeltaUnit,
    type AgentObjectiveMetricComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type AgentObjectiveMetricUnit,
} from '../../models/AgentObjectiveAnalysisTypes';

/**
 * Metric-by-metric link from one receipt to an earlier one.
 *
 * Only scalars subtract. A band profile, an onset list or a flag can differ in
 * ways no single number describes, so those are reported as incomparable rather
 * than reduced to a difference that reads like a measurement.
 */

/** A difference between two loudness figures is loudness units, not LUFS. */
function deltaUnit(unit: AgentObjectiveMetricUnit): AgentObjectiveDeltaUnit {
    if (unit === 'LUFS') {
        return 'LU';
    }
    if (unit === 'dBFS' || unit === 'dBTP') {
        return 'dB';
    }
    return unit;
}

function compareEntries(
    candidate: AgentObjectiveMetricEntry,
    baseline: AgentObjectiveMetricEntry | undefined
): AgentObjectiveMetricComparison {
    if (candidate.status !== 'measured') {
        return { status: 'incomparable', reason: 'candidate-unavailable' };
    }
    if (!baseline || baseline.status !== 'measured') {
        return { status: 'incomparable', reason: 'baseline-unavailable' };
    }
    // Differing units make the pair no more subtractable than a list does: the
    // two numbers are not the same measurement.
    if (typeof candidate.value !== 'number' || typeof baseline.value !== 'number' || candidate.unit !== baseline.unit) {
        return { status: 'incomparable', reason: 'non-scalar' };
    }
    return { status: 'compared', delta: candidate.value - baseline.value, unit: deltaUnit(candidate.unit) };
}

export type CompareAgentObjectiveMeasurementsInput = {
    readonly candidate: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly baseline: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
};

/**
 * The comparison is written out id by id rather than accumulated into an
 * asserted empty record: a literal is total under the checker, so withdrawing or
 * renaming a metric id fails here instead of shipping a comparison that is
 * silently missing a key. The order matches the receipt's own metric order.
 */
export function compareAgentObjectiveMeasurements({
    candidate,
    baseline,
}: CompareAgentObjectiveMeasurementsInput): Record<AgentObjectiveMetricId, AgentObjectiveMetricComparison> {
    const compare = (id: AgentObjectiveMetricId): AgentObjectiveMetricComparison =>
        compareEntries(candidate[id], baseline[id]);

    return {
        samplePeak: compare('samplePeak'),
        truePeak: compare('truePeak'),
        integratedLoudness: compare('integratedLoudness'),
        shortTermLoudnessMax: compare('shortTermLoudnessMax'),
        momentaryLoudnessMax: compare('momentaryLoudnessMax'),
        rms: compare('rms'),
        crestFactor: compare('crestFactor'),
        dynamicRangeEstimate: compare('dynamicRangeEstimate'),
        dcOffset: compare('dcOffset'),
        clippingCount: compare('clippingCount'),
        silentFraction: compare('silentFraction'),
        tailTruncation: compare('tailTruncation'),
        spectralCentroid: compare('spectralCentroid'),
        spectralRolloff: compare('spectralRolloff'),
        frequencyBandEnergy: compare('frequencyBandEnergy'),
        stereoCorrelation: compare('stereoCorrelation'),
        sideEnergyFraction: compare('sideEnergyFraction'),
        lowFrequencyStereoContent: compare('lowFrequencyStereoContent'),
        transientDensity: compare('transientDensity'),
        onsetTimes: compare('onsetTimes'),
        tempoAlignment: compare('tempoAlignment'),
        phasePolarity: compare('phasePolarity'),
        interTrackMasking: compare('interTrackMasking'),
        busHeadroom: compare('busHeadroom'),
        gainStagingAnomalies: compare('gainStagingAnomalies'),
    };
}
