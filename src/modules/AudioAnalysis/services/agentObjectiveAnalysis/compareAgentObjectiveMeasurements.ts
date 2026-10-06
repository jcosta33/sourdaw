import {
    type AgentObjectiveMetricComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
} from '../../models/AgentObjectiveAnalysisTypes';

import { compareAgentObjectiveMetricEntry } from './compareAgentObjectiveMetricEntry';

export type CompareAgentObjectiveMeasurementsInput = {
    readonly candidate: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly baseline: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
};

/**
 * Metric-by-metric link from one receipt to an earlier one, each metric by
 * `compareAgentObjectiveMetricEntry`.
 *
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
        compareAgentObjectiveMetricEntry(candidate[id], baseline[id]);

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
