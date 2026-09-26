/**
 * The metrics an agent measurement reports, in receipt key order.
 *
 * Every id names one scalar or one per-band map. `onsetCount` is the length of
 * the objective analysis's `onsetTimes`; the series itself is never reported.
 */
export const AGENT_MEASUREMENT_METRIC_IDS = [
    'integratedLoudness',
    'shortTermLoudnessMax',
    'momentaryLoudnessMax',
    'truePeak',
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'spectralCentroid',
    'frequencyBandEnergy',
    'stereoCorrelation',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'transientDensity',
    'onsetCount',
] as const;

export type AgentMeasurementMetricId = (typeof AGENT_MEASUREMENT_METRIC_IDS)[number];
