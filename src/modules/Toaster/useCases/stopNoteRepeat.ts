import { activeNoteRepeatSessions } from './noteRepeatState';

export function stopNoteRepeat(deviceId: string): void {
    const session = activeNoteRepeatSessions.get(deviceId);
    if (session) {
        clearTimeout(session.timeoutId);
        activeNoteRepeatSessions.delete(deviceId);
    }
}
