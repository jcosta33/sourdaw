import { pushStore } from '../../stores/push';

export function setScale(rootNote: number, scaleName: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, rootNote: rootNote % 12, scaleName });
}
