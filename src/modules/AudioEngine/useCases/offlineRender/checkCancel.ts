import { createExportError } from '../../errors/ExportError';

import { exportCancellationState } from './exportCancellationState';

/**
 * Throws if a cancel was requested. A render that owns an `abortSignal` passes it, so its own stop
 * ends it without the process-wide flag the other renders read.
 */
export function checkCancel(abortSignal?: AbortSignal): void {
    if (exportCancellationState.cancelFlag || abortSignal?.aborted === true) {
        throw createExportError('Export cancelled');
    }
}
