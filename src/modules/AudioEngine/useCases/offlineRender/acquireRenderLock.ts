import { createExportError } from '../../errors/ExportError';

import { exportCancellationState } from './exportCancellationState';

/**
 * Acquires the render lock. Throws if another render is already running.
 * Returns a release function that MUST be called in a finally block.
 */
export function acquireRenderLock(): () => void {
    if (exportCancellationState.isRenderingActive) {
        throw createExportError(
            'An export is already in progress. Cancel the current export before starting a new one.'
        );
    }
    exportCancellationState.isRenderingActive = true;
    return () => {
        exportCancellationState.isRenderingActive = false;
    };
}
