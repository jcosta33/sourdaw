import { createExportError } from '../../errors/ExportError';

import { exportCancellationState } from './exportCancellationState';

/** Throws if a cancel was requested. */
export function checkCancel(): void {
    if (exportCancellationState.cancelFlag) {
        throw createExportError('Export cancelled');
    }
}
