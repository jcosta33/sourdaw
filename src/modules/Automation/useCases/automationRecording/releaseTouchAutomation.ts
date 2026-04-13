import { touchActive, makeKey, flushPendingPoints } from './recordingSessionState';

export function releaseTouchAutomation(trackId: string, parameterId: string): void {
    const key = makeKey(trackId, parameterId);
    touchActive.delete(key);
    flushPendingPoints(key);
}
