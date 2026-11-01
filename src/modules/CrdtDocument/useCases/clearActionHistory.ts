import { clearActionHistoryInActiveDocument } from '../repositories/clearActionHistoryInActiveDocument';
import { clearActionHistoryStore } from '../stores/actionHistoryStore';

export function clearActionHistory(): void {
    clearActionHistoryInActiveDocument();
    clearActionHistoryStore();
}
