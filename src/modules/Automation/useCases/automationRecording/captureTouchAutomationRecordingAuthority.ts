import { trackStore } from '#/modules/Arrangement/stores';

import { makeKey } from './makeKey';
import { activeRecording } from './recordingSessionState';
import { releaseTouchAutomation } from './releaseTouchAutomation';

export function captureTouchAutomationRecordingAuthority(trackId: string, parameterId: string) {
    const owner = Symbol('Touch automation producer');
    return {
        owner,
        release: () => {
            const mode = trackStore.value?.tracks.find((track) => track.id === trackId)?.automationMode;
            // Switching into Latch keeps the held value even without another sample.
            if (mode === 'latch' || mode === 'write') {
                return;
            }
            const session = activeRecording.get(makeKey(trackId, parameterId));
            if (session?.recordingMode === 'touch') {
                releaseTouchAutomation(trackId, parameterId, owner);
            }
        },
    };
}
