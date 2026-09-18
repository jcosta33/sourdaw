import { type AgentObjectiveMetricEntry, type AgentObjectiveMetricId } from '../models/AgentObjectiveAnalysisTypes';
import { buildAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/buildAgentObjectiveMeasurements';
import { readRenderChannels } from '../services/agentObjectiveAnalysis/readRenderChannels';
import { refineOnsetTimes } from '../services/agentObjectiveAnalysis/refineOnsetTimes';

import { detectOnsets } from './detectOnsets';
import { measureProgramAudio, type ProgramAudioSource } from './referenceMixComparison/analyzeMix/measureProgramAudio';

/**
 * The buffer half of an objective analysis: decoded audio in, the full metric
 * set out.
 *
 * It is separate from the receipts that use it because the figures depend only
 * on the samples, never on where the audio came from. A section render and a
 * library sample therefore read the same procedure, and two receipts naming the
 * same audio report the same numbers.
 */

/** Low enough that a steady passage still registers its accents, high enough to ignore noise. */
const ONSET_SENSITIVITY = 0.3;
/** 50 ms — sixteenths at 300 BPM, below which two attacks are one event. */
const ONSET_MIN_INTERVAL_SECONDS = 0.05;

export type AgentObjectiveBufferMeasurement = {
    readonly measurements: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly durationSeconds: number;
};

/** Equal-weight sum of every channel, the whole buffer as one signal. */
function monoSum(channels: readonly Float32Array[], length: number): Float32Array {
    const mono = new Float32Array(length);
    for (const channel of channels) {
        for (let index = 0; index < length; index++) {
            mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
        }
    }
    return mono;
}

/**
 * Onset times over the whole buffer, empty when it has no channels.
 *
 * Detection runs on the summed channels rather than the first one: a transient
 * that lives only in another channel — a hard-panned percussion overdub, a
 * mid-side-widened hit — is absent from channel 0 entirely, so a receipt read
 * there would report an onset list and a transient density describing one
 * channel while naming the whole audio.
 */
function readOnsetTimes(channels: readonly Float32Array[], length: number, sampleRate: number): number[] {
    if (channels.length === 0) {
        return [];
    }
    const mono = monoSum(channels, length);
    return refineOnsetTimes({
        channel: mono,
        length,
        sampleRate,
        onsetTimesSec: detectOnsets(
            { sampleRate, getChannelData: () => mono },
            ONSET_SENSITIVITY,
            ONSET_MIN_INTERVAL_SECONDS
        ).map((onset) => onset.timeSec),
    });
}

/**
 * The channels this analysis already read, presented to `measureProgramAudio` in
 * the shape it takes, so the programme figures are read from the same sanitised
 * samples as every other metric rather than from the raw buffer.
 */
function programAudioSource(channels: readonly Float32Array[], length: number, sampleRate: number): ProgramAudioSource {
    return {
        numberOfChannels: channels.length,
        length,
        sampleRate,
        getChannelData: (channel: number) => channels[channel] ?? new Float32Array(length),
    };
}

export function measureAgentObjectiveBuffer(buffer: AudioBuffer): AgentObjectiveBufferMeasurement {
    const channels = readRenderChannels(buffer);
    const { length, sampleRate } = buffer;
    // Every figure is read from the samples, so the duration the metrics use is
    // the one the samples describe.
    const durationSeconds = sampleRate > 0 ? length / sampleRate : 0;
    const programAnalysis =
        channels.length > 0 ? measureProgramAudio([programAudioSource(channels, length, sampleRate)]) : null;
    const onsetTimesSec = readOnsetTimes(channels, length, sampleRate);

    return {
        measurements: buildAgentObjectiveMeasurements({
            channels,
            length,
            sampleRate,
            durationSeconds,
            onsetTimesSec,
            dynamicRangeDb: programAnalysis?.dynamicRange ?? null,
        }),
        sampleRate,
        frameCount: length,
        channelCount: channels.length,
        durationSeconds,
    };
}
