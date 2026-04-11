import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { projectStore } from '../../stores/projectStore';
import { addToRecentProjects } from '../recentProjects';

export function saveProject(): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    const updatedAt = Date.now();

    persistCrdtProject()
        .then(() => {
            const current = projectStore.value;
            if (current) {
                projectStore.set({ ...current, updatedAt, dirty: false });
            }
        })
        .catch((error) => {
            console.error('[saveProject] CRDT persistence failed:', error);
        });

    addToRecentProjects(project.name, `sourdaw:project:${project.name}`);
}

export function renameProject(name: string): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    projectStore.set({ ...state, name, dirty: true });
}

export function markDirty(): void {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    if (!state.dirty) {
        projectStore.set({ ...state, dirty: true });
    }
}
