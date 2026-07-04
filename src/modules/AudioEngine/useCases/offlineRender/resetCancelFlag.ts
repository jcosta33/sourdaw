import { exportCancellationState } from './exportCancellationState';

export function resetCancelFlag(): void {
    exportCancellationState.cancelFlag = false;
}
