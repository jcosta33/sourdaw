import { pushStore } from '#/modules/Plugin/stores/push';

export function disconnectPush(): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: false, model: null });
}
