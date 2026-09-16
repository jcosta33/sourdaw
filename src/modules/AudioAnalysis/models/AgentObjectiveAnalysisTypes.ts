/**
 * Objective analysis receipts over a retained section render.
 *
 * The shape exists so an agent can cite measurements instead of impressions.
 * Two rules give it that standing and both are encoded in the types rather than
 * left to callers:
 *
 * - A metric is either measured from the samples or typed as unavailable with
 *   the reason it could not be read. There is no third state, so nothing an
 *   estimate-shaped guess could occupy.
 * - Every receipt names the render it read — the content address and the
 *   document revision that produced it — so a reader can tell whether a figure
 *   still describes the project in front of them.
 */

/** Every metric a receipt reports on, whether or not this build can measure it. */
export type AgentObjectiveMetricId =
    | 'samplePeak'
    | 'truePeak'
    | 'integratedLoudness'
    | 'shortTermLoudnessMax'
    | 'momentaryLoudnessMax'
    | 'rms'
    | 'crestFactor'
    | 'dynamicRangeEstimate'
    | 'dcOffset'
    | 'clippingCount'
    | 'silentFraction'
    | 'tailTruncation'
    | 'spectralCentroid'
    | 'spectralRolloff'
    | 'frequencyBandEnergy'
    | 'stereoCorrelation'
    | 'sideEnergyFraction'
    | 'lowFrequencyStereoContent'
    | 'transientDensity'
    | 'onsetTimes'
    | 'tempoAlignment'
    | 'phasePolarity'
    | 'interTrackMasking'
    | 'busHeadroom'
    | 'gainStagingAnomalies';

/**
 * Declaration order is the receipt's key order: readers and diffs see the same
 * sequence every time, and a receipt missing an id is malformed rather than
 * quietly short.
 */
export const AGENT_OBJECTIVE_METRIC_IDS: readonly AgentObjectiveMetricId[] = [
    'samplePeak',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'momentaryLoudnessMax',
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'dcOffset',
    'clippingCount',
    'silentFraction',
    'tailTruncation',
    'spectralCentroid',
    'spectralRolloff',
    'frequencyBandEnergy',
    'stereoCorrelation',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'transientDensity',
    'onsetTimes',
    'tempoAlignment',
    'phasePolarity',
    'interTrackMasking',
    'busHeadroom',
    'gainStagingAnomalies',
];

export type AgentObjectiveMetricUnit =
    | 'dBFS'
    | 'dBTP'
    | 'LUFS'
    | 'dB'
    | 'ratio'
    | 'count'
    | 'boolean'
    | 'hertz'
    | 'correlation'
    | 'per-second'
    | 'seconds';

/**
 * Why a metric carries no number. `not-implemented` is this build's own gap;
 * the `needs-` reasons are inputs the receipt's subject cannot supply (one
 * rendered stereo file cannot expose per-track phase or bus headroom); the rest
 * are properties of the audio itself.
 */
export type AgentObjectiveMetricUnavailableReason =
    'not-implemented' | 'needs-project-state' | 'needs-multitrack' | 'too-short' | 'silent' | 'mono';

/** Scalars, flags, series and per-band maps are all measurable; each metric fixes one. */
export type AgentObjectiveMetricValue = number | boolean | readonly number[] | Readonly<Record<string, number>>;

export type AgentObjectiveMetricEntry =
    | {
          readonly status: 'measured';
          readonly metricVersion: 1;
          readonly unit: AgentObjectiveMetricUnit;
          readonly value: AgentObjectiveMetricValue;
          /**
           * `exact` is read straight from the samples by a defined procedure;
           * `estimated` comes from a heuristic whose answer depends on window
           * choices. Both are measurements of this audio — the distinction tells
           * a reader how much weight a small difference carries.
           */
          readonly confidence: 'exact' | 'estimated';
      }
    | {
          readonly status: 'unavailable';
          readonly reason: AgentObjectiveMetricUnavailableReason;
      };

/** Deltas in LUFS are loudness units; every other dB-family unit stays dB. */
export type AgentObjectiveDeltaUnit = Exclude<AgentObjectiveMetricUnit, 'LUFS' | 'dBFS' | 'dBTP'> | 'LU';

export type AgentObjectiveMetricComparison =
    | {
          readonly status: 'compared';
          readonly delta: number;
          readonly unit: AgentObjectiveDeltaUnit;
      }
    | {
          readonly status: 'incomparable';
          readonly reason: 'baseline-unavailable' | 'candidate-unavailable' | 'non-scalar';
      };

export type AgentObjectiveComparison = {
    readonly baseline: {
        readonly contentAddress: string;
        readonly sourceRevision: string;
    };
    readonly metrics: Record<AgentObjectiveMetricId, AgentObjectiveMetricComparison>;
};

/** The render a receipt read, in the terms the renderer itself recorded. */
export type AgentObjectiveAnalysisSubject = {
    readonly contentAddress: string;
    readonly sourceRevision: string;
    readonly jobId: string;
    readonly sectionId: string;
    readonly sectionName: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly durationSeconds: number;
};

export type MeasuredAgentObjectiveAnalysisReceipt = {
    readonly status: 'measured';
    readonly schemaVersion: 1;
    readonly subject: AgentObjectiveAnalysisSubject;
    readonly analyzedAt: string;
    readonly measurements: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly comparison: AgentObjectiveComparison | null;
    readonly warnings: readonly string[];
};

/**
 * Why no receipt could be produced at all. Both reasons mean the analysis was
 * asked about audio it does not hold: either nothing matching the caller's job
 * and revision is retained, or what is retained is not the audio the caller
 * named.
 */
export type UnavailableAgentObjectiveAnalysisReceipt = {
    readonly status: 'unavailable';
    readonly reason: 'no-retained-artifact' | 'content-address-mismatch';
};

export type AgentObjectiveAnalysisReceipt =
    MeasuredAgentObjectiveAnalysisReceipt | UnavailableAgentObjectiveAnalysisReceipt;
