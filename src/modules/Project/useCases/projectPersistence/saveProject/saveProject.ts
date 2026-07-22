import { logger } from '#/infra/logger/appLogger';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectStore } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';

export function saveProject(): Promise<void> {
    const project = projectStore.value;
    if (!project) {
        return Promise.resolve();
    }

    const updatedAt = Date.now();

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = `sourdaw:project:${project.createdAt}`;

    // Returned so project-switching callers can await the snapshot before the
    // successor transition resets the stores buildProjectData() reads —
    // otherwise the deferred build can snapshot the SUCCESSOR's state under
    // this project's recent key (audit #568 F2).
    return persistCrdtProject()
        .then(async () => {
            const current = projectStore.value;
            if (current) {
                projectStore.set({ ...current, updatedAt, dirty: false });
            }

            // Option A: write a flat-JSON ProjectData snapshot under the SAME key
            // the recent entry uses, so loadRecentProject can reopen it. The
            // snapshot is the persisted per-project save; the CRDT doc (above) is
            // the live active document. One shared buildProjectData() serializer
            // backs both this snapshot and the .sourdaw export, so they can't
            // drift from the shape hydrateModuleStoresFromProjectData expects.
            const built = await buildProjectData();
            if (built) {
                writeNamedProjectJsonByKey(recentKey, JSON.stringify(built.data));
            }

            // Only record the recent-projects entry once persistence succeeds —
            // otherwise we'd list a project that was never actually saved.
            addToRecentProjects(project.name, recentKey);
        })
        .catch((error) => {
            logger.warn('[saveProject] CRDT persistence failed:', error);
        });
}
