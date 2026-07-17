import { versionControlStore } from '../../../stores/versionControlStore';

export function setAutoSaveInterval(minutes: number): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({ ...state, autoSaveInterval: minutes });
}
