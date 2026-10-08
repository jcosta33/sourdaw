import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { listStoredControllerPostedDevices } from '../../services/storedControllerEngagement';

import { discardStoredMoves } from './discardStoredMoves';

/**
 * Drop the stored moves still queued for a frame that will not come, on every
 * device stored playback posted to, and nothing else.
 *
 * A relocation (a jump, a wrap, an edit's re-emit) does this and lets the window
 * opening at its destination restore the values in force there, lifting a pedal
 * only where no row is in force. It never lifts a pedal itself: a Grand Boule
 * releases the voices a lifted sustain was holding, and that release is not undone
 * by pressing the pedal again, so a lift-then-press would cut ringing notes
 * (which an edit that keeps the playhead in place does not stop). Leaving the
 * posted record intact is what lets that restore know which pedals were moved.
 */
export function discardStaleStoredMoves(): void {
    for (const device of listStoredControllerPostedDevices()) {
        const node = getTrackStrip(device.trackId)?.deviceNodes.find(
            (candidate) => candidate.deviceId === device.deviceId
        );
        if (node) {
            discardStoredMoves(device.deviceType, node);
        }
    }
}
