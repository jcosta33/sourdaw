import { audioRecordingStore } from '../../stores/audioRecordingStore';

import { activeSessions } from './recordingSession';

export function checkAllRecordingsStopped(): void {
    if (activeSessions.size === 0) {
        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
    }
}
