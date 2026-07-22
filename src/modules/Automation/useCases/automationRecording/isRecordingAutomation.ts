import { trackStore } from '#/modules/Arrangement/stores';

import { isRecordingAutomationByKey } from './isRecordingAutomationByKey';
import { makeKey } from './makeKey';
import { activeRecording } from './recordingSessionState';

export function isRecordingAutomation(trackId: string, parameterId: string): boolean {
    const key = makeKey(trackId, parameterId);
    if (!activeRecording.has(key)) {
        return false;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return isRecordingAutomationByKey(key, track?.automationMode);
}
