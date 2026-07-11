import { actionHistoryStore, defaultActionHistoryState } from '../stores/actionHistoryStore';

export function clearActionHistory(): void {
    actionHistoryStore.clear();
    actionHistoryStore.set(defaultActionHistoryState);
}
