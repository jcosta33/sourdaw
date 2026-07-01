import { logger } from '#/infra/logger/appLogger';

import { checkAllRecordingsStopped } from './checkAllRecordingsStopped';
import { activeSessions, STOP_FLUSH_TIMEOUT_MS, type RecordingSession } from './recordingSession';
import { terminateRecordingWorker } from './terminateRecordingWorker';

export function armRecordingStopFlushTimer(session: RecordingSession): void {
    const { trackId } = session;
    session.stopFlushTimer = setTimeout(() => {
        const stalled = activeSessions.get(trackId);
        if (!stalled) {
            return;
        }
        logger.error(
            new Error(
                `Recording worker did not flush within ${STOP_FLUSH_TIMEOUT_MS}ms on track ${trackId}; forcing teardown`
            )
        );
        stalled.onRecordingComplete = null;
        terminateRecordingWorker(stalled);
        activeSessions.delete(trackId);
        checkAllRecordingsStopped();
    }, STOP_FLUSH_TIMEOUT_MS);
}
