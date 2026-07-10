import { activeNoteRepeatSessions } from './noteRepeatState';

export function isNoteRepeating(deviceId: string): boolean {
    return activeNoteRepeatSessions.has(deviceId);
}
