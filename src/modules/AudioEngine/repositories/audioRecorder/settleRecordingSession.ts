import { logger } from '#/infra/logger/appLogger';

import { checkAllRecordingsStopped } from './checkAllRecordingsStopped';
import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
import { activeSessions, type RecordingResult, type RecordingSession } from './recordingSession';
import { terminateRecordingWorker } from './terminateRecordingWorker';

export function settleRecordingSession(session: RecordingSession, result: RecordingResult): boolean {
    const { trackId } = session;
    if (activeSessions.get(trackId) !== session) {
        return false;
    }

    const callback = session.onTerminal;
    session.onTerminal = null;

    try {
        callback?.(result);
    } catch (error) {
        logger.error(new Error(`Recording terminal callback failed on track ${trackId}`, { cause: error }));
    } finally {
        terminateRecordingWorker(session);
        cleanupNodesForRecordingSession(session);
        if (activeSessions.get(trackId) === session) {
            activeSessions.delete(trackId);
        }
        checkAllRecordingsStopped();
    }

    return true;
}
