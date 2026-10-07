import { createExportError } from '../../errors/ExportError';
import { createExportInProgressError } from '../../errors/ExportInProgressError';

import { acquireRenderLock } from './acquireRenderLock';
import { MEASUREMENT_RELEASE_TIMEOUT_MS } from './constants';
import { endExportCancellationScope } from './endExportCancellationScope';
import { exportCancellationState } from './exportCancellationState';

function waitForRelease(released: Promise<void>, cancelled: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const stop = () => {
            clearTimeout(timer);
            cancelled.removeEventListener('abort', onCancel);
        };
        const onCancel = () => {
            stop();
            reject(createExportError('Export cancelled'));
        };
        const timer = setTimeout(() => {
            stop();
            reject(
                createExportError(
                    "The assistant's measurement did not stop in time to start this export. Try the export again in a moment."
                )
            );
        }, MEASUREMENT_RELEASE_TIMEOUT_MS);
        cancelled.addEventListener('abort', onCancel, { once: true });
        void released.then(() => {
            stop();
            resolve();
        });
    });
}

/**
 * A musician's export takes the render lock from an agent measurement (#4768): it stops the
 * measurement, waits for the measurement's render to release, then acquires.
 *
 * The queued marker is set before the wait and cleared in the same synchronous step that acquires, so
 * no other render can take the lock in between and a second export still refuses as today. Only call
 * this when `canPreemptMeasurement()` holds.
 */
export async function acquireRenderLockFromMeasurement(): Promise<() => void> {
    const measurement = exportCancellationState.renderLock;
    if (measurement === null || measurement.preempt === null) {
        throw createExportInProgressError();
    }
    const queued = new AbortController();
    exportCancellationState.queuedMusicianExport = queued;
    measurement.preempt();
    try {
        await waitForRelease(measurement.released, queued.signal);
    } catch (error) {
        exportCancellationState.queuedMusicianExport = null;
        if (queued.signal.aborted) {
            // A Cancel pressed while waiting raised the process-wide flag; this export never began a
            // scope of its own to close it.
            endExportCancellationScope();
        }
        throw error;
    }
    exportCancellationState.queuedMusicianExport = null;
    return acquireRenderLock('musician-export');
}
