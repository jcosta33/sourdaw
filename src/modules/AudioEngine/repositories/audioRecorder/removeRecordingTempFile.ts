import { logger } from '#/infra/logger/appLogger';

import { type RecordingSession } from './recordingSession';

/**
 * Remove the settled session's OPFS temp file. The main thread owns the
 * removal because settlement terminates the worker synchronously, and a
 * terminated worker never resumes its in-flight `removeEntry` — this thread
 * outlives it. Runs on every settle path (empty take, invalid metadata,
 * worker error, worker crash, flush timeout, decode failure, completion).
 *
 * Idempotent: the worker's own removal after posting the WAV is a fast path
 * that may already have deleted the entry, and the file may never have been
 * created (initialization failed before `getFileHandle`). A missing entry is
 * fine; anything else is logged and dropped — the startup sweep retries.
 */
export function removeRecordingTempFile(session: RecordingSession): void {
    const { tempFile } = session;
    session.tempFile = null;
    if (tempFile === null || typeof navigator.storage?.getDirectory !== 'function') {
        return;
    }
    void navigator.storage
        .getDirectory()
        .then((root) => root.removeEntry(tempFile))
        .catch((error: unknown) => logger.debug(`Abandoned recording temp file ${tempFile} not removed`, error));
}
