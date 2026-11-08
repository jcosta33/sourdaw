import {
    type prepareAgentObjectiveBuffer,
    prepareAgentObjectiveOnsets,
} from '../services/agentObjectiveAnalysis/prepareAgentObjectiveBuffer';
import { refineOnsetTimes } from '../services/agentObjectiveAnalysis/refineOnsetTimes';

import { detectOnsets } from './detectOnsets';

/** Detect and refine the same whole-buffer, all-channel attacks for full and selected measurements. */
export function readAgentObjectiveOnsetTimes(prepared: ReturnType<typeof prepareAgentObjectiveBuffer>): number[] {
    if (prepared.channels.length === 0) {
        return [];
    }
    const onset = prepareAgentObjectiveOnsets(prepared);
    return refineOnsetTimes({
        channel: onset.channel,
        length: onset.length,
        sampleRate: onset.sampleRate,
        onsetTimesSec: detectOnsets(onset.source, onset.sensitivity, onset.minIntervalSeconds).map(
            (detected) => detected.timeSec
        ),
    });
}
