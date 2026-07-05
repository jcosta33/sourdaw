import { projectStore } from '../stores/projectStore';

export function setProjectKeyRoot(keyRoot: number): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    if (!Number.isInteger(keyRoot) || keyRoot < 0 || keyRoot > 11) {
        return;
    }

    projectStore.set({ ...project, keyRoot });
}
