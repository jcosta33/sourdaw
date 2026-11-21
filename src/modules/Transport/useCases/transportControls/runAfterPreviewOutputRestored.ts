import { logger } from '#/infra/logger/appLogger';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * A preview that owned the listening output reopens it asynchronously, and a click scheduled
 * before that is silent. The count-in therefore waits for the restoration the record gesture's
 * preview intent reports, and reads the clock afterwards. The wait is a pending recording start,
 * so a second Record press or a stop cancels it instead of stacking a second count-in. A refused
 * restoration still counts in: the output stays closed either way, and the user is not left
 * without a take.
 */
export function runAfterPreviewOutputRestored(ready: Promise<void> | undefined, start: () => void): void {
    if (ready === undefined) {
        start();
        return;
    }
    const startToken = recordingLifecycle.beginPendingRecordingStart();
    void ready
        .catch((error: unknown) => {
            logger.warn(new Error('Preview output was not restored before the count-in', { cause: error }));
        })
        .then(() => {
            if (recordingLifecycle.completePendingRecordingStart(startToken)) {
                start();
            }
            return null;
        });
}
