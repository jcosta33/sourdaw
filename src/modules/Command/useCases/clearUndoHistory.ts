import { clearUndoHistory as clearUndoHistoryInStore } from '../stores/clearUndoHistory';

export function clearUndoHistory(): void {
    clearUndoHistoryInStore();
}
