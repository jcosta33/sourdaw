import { clearRecordingStopFlushTimer } from './clearRecordingStopFlushTimer';
import { type RecordingSession } from './recordingSession';
import { releaseSharedMediaStream } from './releaseSharedMediaStream';

export function cleanupNodesForRecordingSession(session: RecordingSession): void {
    clearRecordingStopFlushTimer(session);
    if (session.recordingNode) {
        session.recordingNode.disconnect();
        session.recordingNode = null;
    }
    if (session.sourceNode) {
        session.sourceNode.disconnect();
        session.sourceNode = null;
    }
    if (session.mediaStream) {
        releaseSharedMediaStream();
        session.mediaStream = null;
    }
}
