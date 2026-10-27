import { getTransportState } from '../../repositories/transport/getTransportState';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * True when nothing is rolling and nothing is about to: not playing, not
 * recording, and no recording start waiting on its token or count-in timer.
 * Read synchronously by a caller that must not replace the document under a
 * live take; it holds only until the caller's next await.
 */
export function isTransportIdle(): boolean {
    const state = getTransportState();
    if (state?.isPlaying || state?.isRecording) {
        return false;
    }
    return !recordingLifecycle.hasPendingRecordingStart();
}
