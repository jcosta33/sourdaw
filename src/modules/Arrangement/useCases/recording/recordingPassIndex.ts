import { activeRecordingRef } from '../../stores/activeRecordingRef';

type EventPosition = { beat: number; passIndex: number };

export function recordingPassIndex(position: EventPosition): number | null {
    if (activeRecordingRef.passIdentityLost) {
        return null;
    }
    const pass = position.passIndex - activeRecordingRef.startWrapCount;
    return Number.isSafeInteger(pass) && pass >= 0 ? pass : null;
}
