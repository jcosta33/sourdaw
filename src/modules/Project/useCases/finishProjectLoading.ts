import { projectStore } from '../stores/projectStore';

export function finishProjectLoading(): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    projectStore.set({ ...project, loading: false });
}
