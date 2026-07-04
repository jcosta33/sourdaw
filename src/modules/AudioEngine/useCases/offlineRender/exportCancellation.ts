import { exportCancellationState } from './exportCancellationState';

export function cancelExport(): void {
    exportCancellationState.cancelFlag = true;
}
