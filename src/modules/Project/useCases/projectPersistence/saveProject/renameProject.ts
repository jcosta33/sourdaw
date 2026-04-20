import { projectStore } from '../../../stores/projectStore';

export function renameProject(name: string): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    projectStore.set({ ...state, name, dirty: true });
}
