import { checkAllRecordingsStopped } from './checkAllRecordingsStopped';
import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
import { activeSessions, type RecordingSession } from './recordingSession';
import { terminateRecordingWorker } from './terminateRecordingWorker';

type CleanupRecordingNodeInput = {
    expectedSession: RecordingSession;
    trackId: string;
};

export function cleanupRecordingNode({ expectedSession, trackId }: CleanupRecordingNodeInput): void {
    const session = activeSessions.get(trackId);
    if (session !== expectedSession) {
        return;
    }

    terminateRecordingWorker(session);
    cleanupNodesForRecordingSession(session);
    activeSessions.delete(trackId);
    checkAllRecordingsStopped();
}
