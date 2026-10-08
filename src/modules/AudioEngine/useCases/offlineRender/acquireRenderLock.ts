import { createExportInProgressError } from '../../errors/ExportInProgressError';
import { createRenderBusyError } from '../../errors/RenderBusyError';

import { exportCancellationState, type RenderLockHolder } from './exportCancellationState';

function createRefusal(holder: RenderLockHolder): Error {
    if (holder === 'musician-export') {
        return createExportInProgressError();
    }
    return createRenderBusyError('Another offline render is in progress.');
}

/**
 * Acquires the render lock for `holder`. Throws if another render holds it or a musician's export is
 * queued for it: a musician's export gets today's "already in progress" message, an agent render a
 * `RenderBusy` error its caller reports as busy. Never waits; a musician's export that must first
 * stop an agent render goes through `acquireRenderLockFromAgentRender`.
 * Returns a release function that MUST be called in a finally block.
 *
 * `preempt` is how a musician's export stops this holder's render; only an agent render passes one.
 */
export function acquireRenderLock(holder: RenderLockHolder, preempt: (() => void) | null = null): () => void {
    if (exportCancellationState.renderLock !== null || exportCancellationState.queuedMusicianExport !== null) {
        throw createRefusal(holder);
    }
    const released = Promise.withResolvers<void>();
    const lock = { holder, preempt, released: released.promise, settleReleased: released.resolve };
    exportCancellationState.renderLock = lock;
    return () => {
        if (exportCancellationState.renderLock === lock) {
            exportCancellationState.renderLock = null;
        }
        lock.settleReleased();
    };
}
