import { exportCancellationState } from './exportCancellationState';

/**
 * Close the cancellation scope `beginExportCancellationScope` opened, once the
 * export that owns it has settled (#4782).
 *
 * A cancelled export raises the flag and aborts the scope's controller, and
 * both must not outlive the render that raised them: state that reads "cancel
 * requested" while nothing is rendering is a trap for the next reader. The
 * fresh controller mirrors the scope's start, so the signal installed in state
 * always belongs to the scope window that is currently open.
 */
export function endExportCancellationScope(): void {
    exportCancellationState.cancelFlag = false;
    exportCancellationState.controller = new AbortController();
}
