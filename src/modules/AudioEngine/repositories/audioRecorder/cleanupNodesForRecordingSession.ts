import { type RecordingSession } from './recordingSession';
import { releaseSharedMediaStream } from './releaseSharedMediaStream';

export function cleanupNodesForRecordingSession(session: RecordingSession): void {
    if (session.recordingNode) {
        session.recordingNode.port.onmessage = null;
        session.recordingNode.disconnect();
        session.recordingNode = null;
    }
    if (session.sourceNode) {
        session.sourceNode.disconnect();
        session.sourceNode = null;
    }
    if (session.mediaStream) {
        releaseSharedMediaStream(session.mediaStream);
        session.mediaStream = null;
    }
}
