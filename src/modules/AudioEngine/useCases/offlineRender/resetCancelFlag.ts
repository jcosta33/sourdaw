import { exportCancellationState } from './exportCancellationState';

export function resetCancelFlag(): void {
    exportCancellationState.cancelFlag = false;
    // A fresh controller, so a cancelled scope's aborted signal cannot leak
    // into a render that merely clears the flag. Callers that want the scope's
    // signal for threading use `beginExportCancellationScope` instead.
    exportCancellationState.controller = new AbortController();
}
