import { getTransportState } from '../../repositories/transport/getTransportState';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * True when nothing is rolling and nothing is about to: not playing, not
 * recording, no recording start waiting on its token or count-in timer, and no
 * take still closing. A user's Pause or Stop turns the transport idle at once
 * and then awaits the recorder's flush and the take's commit, so a transport
 * that reads stopped can still be about to write the take into the project.
 * Read synchronously by a caller that must not replace the document under a
 * live take; it holds only until the caller's next await.
 */
export function isTransportIdle(): boolean {
    const state = getTransportState();
    if (state?.isPlaying || state?.isRecording) {
        return false;
    }
    return !recordingLifecycle.hasPendingRecordingStart() && !recordingLifecycle.isClosingRecording();
}
