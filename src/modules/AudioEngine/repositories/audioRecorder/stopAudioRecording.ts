import { audioRecordingStore } from '../../stores/audioRecordingStore';

import { armRecordingStopFlushTimer } from './armRecordingStopFlushTimer';
import { activeSessions, recordingLifecycleState } from './recordingSession';
import { waitForRecordingSessions } from './waitForRecordingSessions';

export function stopAudioRecording(): Promise<void> {
    recordingLifecycleState.startGeneration++;
    const stoppedTrackIds = new Set(activeSessions.keys());
    for (const session of activeSessions.values()) {
        if (session.status === 'stopping') {
            continue;
        }
        session.status = 'stopping';
        armRecordingStopFlushTimer(session);
        session.recordingNode?.port.postMessage({ type: 'stop' });
    }

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
    return waitForRecordingSessions(stoppedTrackIds);
}
