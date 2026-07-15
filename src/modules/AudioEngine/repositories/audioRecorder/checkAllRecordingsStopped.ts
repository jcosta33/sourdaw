import { audioRecordingStore } from '../../stores/audioRecordingStore';

import { activeSessions, recordingLifecycleState } from './recordingSession';

export function checkAllRecordingsStopped(): void {
    for (const waiter of recordingLifecycleState.stopWaiters) {
        if ([...waiter.trackIds].every((trackId) => !activeSessions.has(trackId))) {
            recordingLifecycleState.stopWaiters.delete(waiter);
            waiter.resolve();
        }
    }

    if (activeSessions.size === 0) {
        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
    }
}
