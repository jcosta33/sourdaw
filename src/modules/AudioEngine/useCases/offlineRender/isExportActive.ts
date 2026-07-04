import { exportCancellationState } from './exportCancellationState';

/**
 * Whether a render (mixdown or stems) is currently in progress.
 * Consumers can read this to prevent a second export from being triggered.
 */
export function isExportActive(): boolean {
    return exportCancellationState.isRenderingActive;
}
