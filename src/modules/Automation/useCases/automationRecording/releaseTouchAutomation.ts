import { pendingAutoMatch } from './autoMatchState';
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
        // Arm the AutoMatch glide before clearing lastValue — it is the
        // value the control held at release, and the point the parameter must
        // glide back to the underlying automation *from*. Without this the next
        // applyAutomation hands the parameter straight back to the curve and the
        // value can step.
        if (session.lastValue !== null) {
            pendingAutoMatch.set(key, { releasedValue: session.lastValue, startedAtSeconds: null });
        }
        session.lastValue = null;
    }
}
