import { pushStore } from '../../stores/push';

export function connectPush(model: 'push2' | 'push3'): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: true, model });
}
