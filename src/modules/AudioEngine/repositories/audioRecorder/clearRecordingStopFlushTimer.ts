import { type RecordingSession } from './recordingSession';

export function clearRecordingStopFlushTimer(session: RecordingSession): void {
    if (session.stopFlushTimer !== null) {
        clearTimeout(session.stopFlushTimer);
        session.stopFlushTimer = null;
    }
}
