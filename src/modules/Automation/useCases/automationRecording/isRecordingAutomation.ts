import { trackStore } from '#/modules/Arrangement/stores';

import { isRecordingAutomationByKey } from './isRecordingAutomationByKey';
import { makeKey } from './makeKey';

export function isRecordingAutomation(trackId: string, parameterId: string): boolean {
    const key = makeKey(trackId, parameterId);
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return isRecordingAutomationByKey(key, track?.automationMode);
}
