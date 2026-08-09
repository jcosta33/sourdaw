import { projectLoadFailureStore } from '../stores/projectLoadFailureStore';
import { projectStore } from '../stores/projectStore';

export function finishProjectLoading(): void {
    // A project is open again, so any earlier failure surface is stale.
    projectLoadFailureStore.set(null);

    const project = projectStore.value;
    if (!project) {
        return;
    }

    projectStore.set({ ...project, loading: false });
}
