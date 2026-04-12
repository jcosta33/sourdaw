import { pushStore } from '../../stores/push';

export function disconnectPush(): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: false, model: null });
}
