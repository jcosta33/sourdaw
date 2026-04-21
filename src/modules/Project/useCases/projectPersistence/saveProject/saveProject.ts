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

    persistCrdtProject()
        .then(() => {
            const current = projectStore.value;
            if (current) {
                projectStore.set({ ...current, updatedAt, dirty: false });
            }
            return null;
        })
        .catch((error) => {
            logger.warn('[saveProject] CRDT persistence failed:', error);
            return null;
        });

    addToRecentProjects(project.name, `sourdaw:project:${project.name}`);
}
