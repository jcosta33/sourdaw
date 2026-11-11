import { makeKey } from './makeKey';
import { activeRecording, pendingPoints, touchActive } from './recordingSessionState';

export function discardTouchAutomation(trackId: string, parameterId: string, recordingOwner?: symbol): void {
    const key = makeKey(trackId, parameterId);
    const session = activeRecording.get(key);
    if (recordingOwner !== undefined && session?.recordingOwner !== recordingOwner) {
        return;
    }
    pendingPoints.set(key, []);
    touchActive.delete(key);
    if (session) {
        session.lastValue = null;
    }
}
