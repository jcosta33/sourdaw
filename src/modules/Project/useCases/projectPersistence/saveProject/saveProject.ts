import { logger } from '#/infra/logger/appLogger';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { projectStore } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';

export function saveProject(): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    const updatedAt = Date.now();

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = `sourdaw:project:${project.createdAt}`;

    persistCrdtProject()
        .then(() => {
            const current = projectStore.value;
            if (current) {
                projectStore.set({ ...current, updatedAt, dirty: false });
            }
            // Only record the recent-projects entry once persistence succeeds —
            // otherwise we'd list a project that was never actually saved.
            addToRecentProjects(project.name, recentKey);
            return null;
        })
        .catch((error) => {
            logger.warn('[saveProject] CRDT persistence failed:', error);
            return null;
        });
}
