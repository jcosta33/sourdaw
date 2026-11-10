import { type AgentObjectiveMetricEntry, type AgentObjectiveMetricId } from '../models/AgentObjectiveAnalysisTypes';
import { buildAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/buildAgentObjectiveMeasurements';
import {
    prepareAgentObjectiveBuffer,
    prepareAgentObjectiveProgramme,
} from '../services/agentObjectiveAnalysis/prepareAgentObjectiveBuffer';

import { readAgentObjectiveOnsetTimes } from './readAgentObjectiveOnsetTimes';
import { measureProgramAudio } from './referenceMixComparison/analyzeMix/measureProgramAudio';

/**
 * The buffer half of an objective analysis: decoded audio in, the full metric
 * set out.
 *
 * It is separate from the receipts that use it because the figures depend only
 * on the samples, never on where the audio came from. A section render and a
 * library sample therefore read the same procedure, and two receipts naming the
 * same audio report the same numbers.
 */

export type AgentObjectiveBufferMeasurement = {
    readonly measurements: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly durationSeconds: number;
};

export function measureAgentObjectiveBuffer(buffer: AudioBuffer): AgentObjectiveBufferMeasurement {
    const prepared = prepareAgentObjectiveBuffer(buffer);
    const { channels, length, sampleRate, durationSeconds } = prepared;
    const programAnalysis =
        channels.length > 0 ? measureProgramAudio([prepareAgentObjectiveProgramme(prepared)]) : null;
    const onsetTimesSec = readAgentObjectiveOnsetTimes(prepared);

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
