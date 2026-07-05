import { actionHistoryStore } from '../stores/actionHistoryStore';

export function clearActionHistory(): void {
    actionHistoryStore.set({ entries: [] });
}
