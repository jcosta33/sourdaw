import { type MeasuredMetricEntry } from '../models/MeasuredPreview';

import { type ObjectiveMetricId } from './metricGoalContractTypes';

export const OBJECTIVE_METRIC_LABELS: Readonly<Record<ObjectiveMetricId, string>> = {
    integratedLoudness: 'integrated loudness',
    shortTermLoudnessMax: 'maximum short-term loudness',
    momentaryLoudnessMax: 'maximum momentary loudness',
    truePeak: 'true peak',
    rms: 'RMS level',
    crestFactor: 'crest factor',
    dynamicRangeEstimate: 'estimated dynamic range',
    spectralCentroid: 'spectral centroid',
    frequencyBandEnergy: 'frequency-band energy',
    stereoCorrelation: 'stereo correlation',
    sideEnergyFraction: 'side energy fraction',
    lowFrequencyStereoContent: 'low-frequency stereo content',
    transientDensity: 'transient density',
    onsetCount: 'onset count',
};

export const OBJECTIVE_METRIC_UNITS: Readonly<Record<ObjectiveMetricId, string>> = {
    integratedLoudness: 'LUFS',
    shortTermLoudnessMax: 'LUFS',
    momentaryLoudnessMax: 'LUFS',
    truePeak: 'dBTP',
    rms: 'dBFS',
    crestFactor: 'dB',
    dynamicRangeEstimate: 'dB',
    spectralCentroid: 'hertz',
    frequencyBandEnergy: 'ratio',
    stereoCorrelation: 'correlation',
    sideEnergyFraction: 'ratio',
    lowFrequencyStereoContent: 'ratio',
    transientDensity: 'per-second',
    onsetCount: 'count',
};

/** A physical scalar, including an explicitly frozen band, never a convenient projection of a map. */
export function objectiveMetricProjection(
    metricId: ObjectiveMetricId,
    entry: MeasuredMetricEntry | undefined,
    band: string | null = null
): { value: number; unit: string } | null {
    if (entry?.status !== 'measured' || entry.metricVersion !== 1 || entry.unit !== OBJECTIVE_METRIC_UNITS[metricId]) {
        return null;
    }
    let value: unknown = entry.value;
    if (metricId === 'frequencyBandEnergy') {
        if (
            band === null ||
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            !Object.hasOwn(value, band)
        ) {
            return null;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, band);
        value = descriptor?.value;
    } else if (band !== null) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return { value, unit: entry.unit };
}
