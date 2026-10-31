import { audioEngine, getCompensationDelay } from '#/modules/AudioEngine/useCases';

import { captureEventPositionAt } from './captureEventBeat';

/** The same heard-instant latency basis recorded notes and controllers use. */
export function captureCompensatedRecordingPosition(
    trackId: string,
    audioTime: number
): {
    beat: number;
    passIndex: number;
} {
    const context = audioEngine.context;
    const delay = (context.baseLatency || 0) + (context.outputLatency || 0) + getCompensationDelay(trackId);
    return captureEventPositionAt({ audioTime: audioTime - delay });
}
