import { logger } from '#/infra/logger/appLogger';

import { cleanupRecordingNode } from './cleanupRecordingNode';
import { activeSessions, STOP_FLUSH_TIMEOUT_MS, type RecordingSession } from './recordingSession';

export function armRecordingStopFlushTimer(session: RecordingSession): void {
    const { trackId } = session;
    session.stopFlushTimer = setTimeout(() => {
        const stalled = activeSessions.get(trackId);
        if (stalled !== session) {
            return;
        }
        logger.error(
            new Error(
                `Recording worker did not flush within ${STOP_FLUSH_TIMEOUT_MS}ms on track ${trackId}; forcing teardown`
            )
        );
        stalled.onRecordingComplete = null;
        cleanupRecordingNode({ expectedSession: session, trackId });
    }, STOP_FLUSH_TIMEOUT_MS);
}
