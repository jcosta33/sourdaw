import { exportCancellationState } from './exportCancellationState';

/**
 * Whether a musician's render (mixdown or stems) holds the render lock or is queued for it.
 * Consumers can read this to prevent a second export from being triggered. An agent
 * measurement's render does not count: a musician's export outranks it (#4768).
 */
export function isExportActive(): boolean {
    return (
        exportCancellationState.renderLock?.holder === 'musician-export' ||
        exportCancellationState.queuedMusicianExport !== null
    );
}
