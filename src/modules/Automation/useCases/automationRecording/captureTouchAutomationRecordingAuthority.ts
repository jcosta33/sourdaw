import { makeKey } from './makeKey';
import { activeRecording } from './recordingSessionState';
import { releaseTouchAutomation } from './releaseTouchAutomation';

export function captureTouchAutomationRecordingAuthority(trackId: string, parameterId: string) {
    const owner = Symbol('Touch automation producer');
    return {
        owner,
        release: () => {
            const session = activeRecording.get(makeKey(trackId, parameterId));
            if (session?.recordingMode === 'touch') {
                releaseTouchAutomation(trackId, parameterId, owner);
            }
        },
    };
}
