import { measureIntegratedLoudness } from '#/utils/audioMetering/measureIntegratedLoudness';
import { measureMaxWindowedLoudness } from '#/utils/audioMetering/measureMaxWindowedLoudness';
import { measureTruePeak } from '#/utils/audioMetering/measureTruePeak';

import {
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type AgentObjectiveMetricUnavailableReason,
    type AgentObjectiveMetricUnit,
    type AgentObjectiveMetricValue,
} from '../../models/AgentObjectiveAnalysisTypes';

import { measureRenderLevels, RENDER_SILENCE_LINEAR, type RenderLevelReadings } from './measureRenderLevels';
import { measureRenderSpectrum, SPECTRUM_FRAME } from './measureRenderSpectrum';
import { measureRenderStereo } from './measureRenderStereo';

/**
 * Every metric of one receipt, measured from the render's samples.
 *
 * The record is total by construction: each id is present in every receipt,
 * carrying either a number this build read or the reason it could not read one.
 * Nothing here falls back to a plausible figure, because a receipt exists to be
 * cited and an inferred number cannot be told from a measured one once quoted.
 */

/** BS.1770 needs one 400 ms block; below that there is no loudness to report. */
const MINIMUM_LOUDNESS_SECONDS = 0.4;
/** EBU Tech 3341 short-term and momentary windows. */
const SHORT_TERM_WINDOW_SECONDS = 3;
const MOMENTARY_WINDOW_SECONDS = 0.4;
/**
 * `measureProgramAudio` fills its frame window with a stand-in rather than
 * refusing: a render below its 2048-sample frame window comes back with a
 * dynamic range of 0 because no frame was measured. That reads as a figure, so
 * the receipt refuses it at that length instead of publishing it.
 */
const DYNAMIC_RANGE_FRAMES = 2048;

export type BuildAgentObjectiveMeasurementsInput = {
    readonly channels: readonly Float32Array[];
    readonly length: number;
    readonly sampleRate: number;
    readonly durationSeconds: number;
    readonly onsetTimesSec: readonly number[];
    /** `measureProgramAudio` dynamic range, or null when it found no programme. */
    readonly dynamicRangeDb: number | null;
};

type MetricEntries<Id extends AgentObjectiveMetricId> = Record<Id, AgentObjectiveMetricEntry>;

type RenderMeasurementContext = BuildAgentObjectiveMeasurementsInput & {
    readonly levels: RenderLevelReadings;
    /**
     * Digital silence is a measured state, not a level: reporting -inf dBFS or a
     * K-weighted reading of nothing would invite a normalisation stage to act on it.
     */
    readonly silent: boolean;
};

function measured(
    unit: AgentObjectiveMetricUnit,
    value: AgentObjectiveMetricValue,
    confidence: 'exact' | 'estimated'
): AgentObjectiveMetricEntry {
    return { status: 'measured', metricVersion: 1, unit, value, confidence };
}

function unavailable(reason: AgentObjectiveMetricUnavailableReason): AgentObjectiveMetricEntry {
    return { status: 'unavailable', reason };
}

/**
 * A null integrated reading over material long enough to gate is programme the
 * BS.1770 absolute gate rejected, not silence: the render carries samples, they
 * are simply quieter than -70 LUFS. Silence is caught before this is reached.
 */
function integratedLoudnessEntry(lufs: number | null, durationSeconds: number): AgentObjectiveMetricEntry {
    if (lufs === null) {
        return unavailable(durationSeconds < MINIMUM_LOUDNESS_SECONDS ? 'too-short' : 'below-gate');
    }
    return measured('LUFS', lufs, 'exact');
}

/** A windowed maximum reads null only when the render is shorter than its window. */
function windowedLoudnessEntry(
    lufs: number | null,
    durationSeconds: number,
    windowSeconds: number
): AgentObjectiveMetricEntry {
    if (lufs === null) {
        return unavailable(durationSeconds < windowSeconds ? 'too-short' : 'silent');
    }
    return measured('LUFS', lufs, 'exact');
}

/** The frame-percentile estimate needs one whole frame; a shorter render has none. */
function dynamicRangeEntry(length: number, dynamicRangeDb: number | null): AgentObjectiveMetricEntry {
    if (length < DYNAMIC_RANGE_FRAMES) {
        return unavailable('too-short');
    }
    if (dynamicRangeDb === null) {
        return unavailable('silent');
    }
    return measured('dB', dynamicRangeDb, 'estimated');
}

type LoudnessMetricId =
    | 'samplePeak'
    | 'truePeak'
    | 'integratedLoudness'
    | 'shortTermLoudnessMax'
    | 'momentaryLoudnessMax'
    | 'rms'
    | 'crestFactor'
    | 'dynamicRangeEstimate';

function buildLoudnessEntries(context: RenderMeasurementContext): MetricEntries<LoudnessMetricId> {
    const { channels, length, sampleRate, durationSeconds, dynamicRangeDb, levels, silent } = context;
    const silence = unavailable('silent');
    if (silent) {
        return {
            samplePeak: silence,
            truePeak: silence,
            integratedLoudness: silence,
            shortTermLoudnessMax: silence,
            momentaryLoudnessMax: silence,
            rms: silence,
            crestFactor: silence,
            dynamicRangeEstimate: silence,
        };
    }

    const window = { channels, length, sampleRate };
    return {
        samplePeak: measured('dBFS', levels.samplePeakDbfs, 'exact'),
        truePeak: measured('dBTP', 20 * Math.log10(measureTruePeak({ channels, length })), 'exact'),
        integratedLoudness: integratedLoudnessEntry(measureIntegratedLoudness(window), durationSeconds),
        shortTermLoudnessMax: windowedLoudnessEntry(
            measureMaxWindowedLoudness({ ...window, windowSeconds: SHORT_TERM_WINDOW_SECONDS }),
            durationSeconds,
            SHORT_TERM_WINDOW_SECONDS
        ),
        momentaryLoudnessMax: windowedLoudnessEntry(
            measureMaxWindowedLoudness({ ...window, windowSeconds: MOMENTARY_WINDOW_SECONDS }),
            durationSeconds,
            MOMENTARY_WINDOW_SECONDS
        ),
        rms: measured('dBFS', levels.rmsDbfs, 'exact'),
        crestFactor: measured('dB', levels.samplePeakDbfs - levels.rmsDbfs, 'exact'),
        dynamicRangeEstimate: dynamicRangeEntry(length, dynamicRangeDb),
    };
}

type LevelMetricId = 'dcOffset' | 'clippingCount' | 'silentFraction' | 'tailTruncation';

function buildLevelEntries({ length, levels, silent }: RenderMeasurementContext): MetricEntries<LevelMetricId> {
    const tail = measured('boolean', levels.tailEnergetic, 'estimated');
    return {
        dcOffset: measured('ratio', levels.dcOffset, 'exact'),
        clippingCount: measured('count', levels.clippingCount, 'exact'),
        // A render with no frames has no silent fraction: the zero the frame
        // counter returns there means "no frames", not "no silence".
        silentFraction: length > 0 ? measured('ratio', levels.silentFraction, 'exact') : unavailable('too-short'),
        tailTruncation: silent ? unavailable('silent') : tail,
    };
}

type SpectralMetricId = 'spectralCentroid' | 'spectralRolloff' | 'frequencyBandEnergy';

/**
 * A silent render is silent at every length, so silence answers before length
 * here as it does everywhere else in this receipt. Below one analysis frame
 * there is nothing to transform. At or above one frame the transform reaches
 * every sample, including the ones past the last whole frame, so a render with
 * no reading is one whose frames hold nothing but a constant — a DC offset the
 * receipt reports as a level, carrying no sound for a spectrum to place. That
 * is silence at the frames that were measured rather than a length the
 * measurement cannot reach.
 */
function spectrumMissingReason(silent: boolean, length: number): AgentObjectiveMetricUnavailableReason {
    if (silent) {
        return 'silent';
    }
    return length < SPECTRUM_FRAME ? 'too-short' : 'silent';
}

function buildSpectralEntries(context: RenderMeasurementContext): MetricEntries<SpectralMetricId> {
    const { channels, length, sampleRate, silent } = context;
    const spectrum = silent ? null : measureRenderSpectrum({ channels, length, sampleRate });
    const missing = unavailable(spectrumMissingReason(silent, length));

    return {
        spectralCentroid: spectrum ? measured('hertz', spectrum.centroidHz, 'estimated') : missing,
        spectralRolloff: spectrum ? measured('hertz', spectrum.rolloffHz, 'estimated') : missing,
        frequencyBandEnergy: spectrum ? measured('ratio', spectrum.bandEnergy, 'estimated') : missing,
    };
}

type StereoMetricId = 'stereoCorrelation' | 'sideEnergyFraction' | 'lowFrequencyStereoContent';

function buildStereoEntries({ channels, length, silent }: RenderMeasurementContext): MetricEntries<StereoMetricId> {
    const left = channels[0];
    const right = channels[1];
    const stereo = !silent && left && right ? measureRenderStereo({ left, right, length }) : null;
    /** One channel has no stereo relationship to report at any level. */
    const missing = channels.length < 2 ? unavailable('mono') : unavailable('silent');

    return {
        stereoCorrelation: stereo ? measured('correlation', stereo.correlation, 'exact') : missing,
        sideEnergyFraction: stereo ? measured('ratio', stereo.sideEnergyFraction, 'exact') : missing,
        // Mid/side band splitting is measurable from this same buffer; nothing
        // here estimates it in the meantime.
        lowFrequencyStereoContent: unavailable('not-implemented'),
    };
}

type TransientMetricId = 'transientDensity' | 'onsetTimes';

function buildTransientEntries(context: RenderMeasurementContext): MetricEntries<TransientMetricId> {
    const { durationSeconds, onsetTimesSec, silent } = context;
    if (silent) {
        const silence = unavailable('silent');
        return { transientDensity: silence, onsetTimes: silence };
    }

    const onsetsPerSecond = durationSeconds > 0 ? onsetTimesSec.length / durationSeconds : 0;
    return {
        transientDensity: measured('per-second', onsetsPerSecond, 'estimated'),
        onsetTimes: measured('seconds', [...onsetTimesSec], 'estimated'),
    };
}

export function buildAgentObjectiveMeasurements(
    input: BuildAgentObjectiveMeasurementsInput
): Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry> {
    const { channels, length, sampleRate } = input;
    const levels = measureRenderLevels({ channels, length, sampleRate });
    const context = { ...input, levels, silent: levels.peak <= RENDER_SILENCE_LINEAR };

    return {
        ...buildLoudnessEntries(context),
        ...buildLevelEntries(context),
        ...buildSpectralEntries(context),
        ...buildStereoEntries(context),
        ...buildTransientEntries(context),
        // The render alone cannot answer these: tempo alignment and gain
        // staging need the project the render came from, and phase, masking and
        // bus headroom need the individual tracks rather than their sum.
        tempoAlignment: unavailable('needs-project-state'),
        phasePolarity: unavailable('needs-multitrack'),
        interTrackMasking: unavailable('needs-multitrack'),
        busHeadroom: unavailable('needs-project-state'),
        gainStagingAnomalies: unavailable('needs-project-state'),
    };
}
