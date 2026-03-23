import { getTrackById } from '#/modules/Track/repositories/trackRepository';
import {
    activeRecording,
    touchActive,
    makeKey,
} from '#/modules/Automation/stores/automationRecordingState';

export function isRecordingAutomation(trackId: string, parameterId: string): boolean {
    const key = makeKey(trackId, parameterId);
    const session = activeRecording.get(key);
    if (!session) {
        return false;
    }

    const track = getTrackById(trackId);
    if (!track) {
        return false;
    }

    if (track.automationMode === 'write') {
        return true;
    }

    if (track.automationMode === 'touch') {
        return touchActive.has(key);
    }

    if (track.automationMode === 'latch') {
        return touchActive.has(key) || session.lastValue !== null;
    }

    return false;
}
