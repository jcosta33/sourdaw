import { type ProjectLoadFailureState, projectLoadFailureStore } from '../stores/projectLoadFailureStore';
import { projectStore } from '../stores/projectStore';

export function reportProjectLoadFailure(failure: ProjectLoadFailureState): void {
    projectLoadFailureStore.set(failure);

    const project = projectStore.value;
    if (!project) {
        return;
    }

    projectStore.set({ ...project, loading: false });
}
