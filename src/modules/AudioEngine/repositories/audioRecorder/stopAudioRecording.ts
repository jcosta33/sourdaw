import { audioRecordingStore } from '../../stores/audioRecordingStore';

import { armRecordingStopFlushTimer } from './armRecordingStopFlushTimer';
import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
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
        session.recordingNode?.port.postMessage({ type: 'stop' });
        session.recordingWorker?.postMessage({ type: 'stop' });
        cleanupNodesForRecordingSession(session);
        armRecordingStopFlushTimer(session);
    }

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
    return waitForRecordingSessions(stoppedTrackIds);
}
