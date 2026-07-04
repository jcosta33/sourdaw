import { exportCancellationState } from './exportCancellationState';

export function isCancelRequested(): boolean {
    return exportCancellationState.cancelFlag;
}
