import { clearRecordingStopFlushTimer } from './clearRecordingStopFlushTimer';
import { type RecordingSession } from './recordingSession';

export function terminateRecordingWorker(session: RecordingSession): void {
    clearRecordingStopFlushTimer(session);
    session.recordingWorker?.terminate();
    session.recordingWorker = null;
}
