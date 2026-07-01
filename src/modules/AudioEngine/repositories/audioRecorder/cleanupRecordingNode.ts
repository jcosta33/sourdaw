import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
import { activeSessions } from './recordingSession';

export function cleanupRecordingNode(trackId: string): void {
    const session = activeSessions.get(trackId);
    if (session) {
        cleanupNodesForRecordingSession(session);
        activeSessions.delete(trackId);
    }
}
