import { flushPendingPoints } from './flushPendingPoints';
import { makeKey } from './makeKey';
import { activeRecording, touchActive } from './recordingSessionState';

export function releaseTouchAutomation(trackId: string, parameterId: string): void {
    const key = makeKey(trackId, parameterId);
    touchActive.delete(key);
    flushPendingPoints(key);

    // Disarm latch: latch's `isRecordingAutomation` stays true while
    // `session.lastValue !== null`, so without this the lane keeps being
    // skipped by applyAutomation after release and the engine drifts off the
    // recorded curve until stop. Clearing lastValue ends the recording window.
    const session = activeRecording.get(key);
    if (session) {
        session.lastValue = null;
    }
}
