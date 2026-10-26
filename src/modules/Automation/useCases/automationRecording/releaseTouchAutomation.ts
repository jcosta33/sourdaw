import { pendingAutoMatch } from './autoMatchState';
import { flushPendingPoints } from './flushPendingPoints';
import { makeKey } from './makeKey';
import { activeRecording, touchActive } from './recordingSessionState';

export function captureTouchAutomationRecordingAuthority(trackId: string, parameterId: string) {
    const owner = Symbol('Touch automation producer');
    return { owner, release: () => releaseTouchAutomation(trackId, parameterId, owner) };
}

export function releaseTouchAutomation(trackId: string, parameterId: string, recordingOwner?: symbol): void {
    const key = makeKey(trackId, parameterId);
    const session = activeRecording.get(key);
    if (recordingOwner !== undefined && session?.recordingOwner !== recordingOwner) {
        return;
    }
    touchActive.delete(key);
    flushPendingPoints(key);

    // Disarm latch: latch's `isRecordingAutomation` stays true while
    // `session.lastValue !== null`, so without this the lane keeps being
    // skipped by applyAutomation after release and the engine drifts off the
    // recorded curve until stop. Clearing lastValue ends the recording window.
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
