import { getTransportState } from '../../repositories/transport/getTransportState';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * True when nothing is rolling, recording, or about to: a Play or Record
 * gesture that is still counting in or opening its capture is not idle yet.
 */
export function isTransportIdle(): boolean {
    const state = getTransportState();
    if (!state) {
        return true;
    }
    return !state.isPlaying && !state.isRecording && !recordingLifecycle.hasPendingRecordingStart();
}
