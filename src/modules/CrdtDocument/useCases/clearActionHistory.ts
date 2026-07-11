import { clearActionHistoryInActiveDocument } from '../repositories/clearActionHistoryInActiveDocument';
import { actionHistoryStore, defaultActionHistoryState } from '../stores/actionHistoryStore';

export function clearActionHistory(): void {
    clearActionHistoryInActiveDocument();
    actionHistoryStore.set(defaultActionHistoryState);
}
