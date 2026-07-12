import { actionHistoryStore } from '../../stores/actionHistoryStore';

export function projectActionHistoryToStore(): void {
    actionHistoryStore.hydrate();
}
