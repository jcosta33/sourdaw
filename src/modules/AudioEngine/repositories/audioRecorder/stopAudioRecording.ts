import { audioRecordingStore } from '../../stores/audioRecordingStore';

import { armRecordingStopFlushTimer } from './armRecordingStopFlushTimer';
import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
import { activeSessions } from './recordingSession';

export function stopAudioRecording(): void {
    for (const session of activeSessions.values()) {
        session.recordingNode?.port.postMessage({ type: 'stop' });
        session.recordingWorker?.postMessage({ type: 'stop' });
        cleanupNodesForRecordingSession(session);
        armRecordingStopFlushTimer(session);
    }

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
}
