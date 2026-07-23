import { logger } from '#/infra/logger/appLogger';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { writeNamedProjectJsonByKey } from '../../../repositories/project/writeNamedProjectJsonByKey';
import { projectStore } from '../../../stores/projectStore';
import { addToRecentProjects } from '../../recentProjects/addToRecentProjects';
import { buildProjectData } from '../fileIO/buildProjectData';

import { captureExternalPluginStates } from './captureExternalPluginStates';

export async function saveProject(): Promise<boolean> {
    const project = projectStore.value;
    if (!project) {
        return true;
    }

    const updatedAt = Date.now();

    // Key recent projects by a stable per-project id (createdAt, set once at
    // creation and preserved across renames and reloads) rather than the
    // mutable display name — so duplicate names don't collide and a rename
    // doesn't orphan the old key.
    const recentKey = `sourdaw:project:${project.createdAt}`;

    // Capture each loaded native plugin's live state chunk into project truth
    // before serialization, so a reopened project restores editor-driven state
    // (presets, oversampling, internal routing) instead of plugin defaults
    // (PH-3). A capture failure must not abort the save — the rest of the
    // project still persists.
    try {
        await captureExternalPluginStates();
    } catch (error) {
        logger.warn('[saveProject] Native plugin state capture failed:', error);
    }

    // Returned so project-switching callers can await the snapshot before the
    // successor transition resets the stores buildProjectData() reads — and
    // ABORT the transition when the save fails, keeping the current project
    // open instead of switching away from unsaved work (audit #568 F2).
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
            return true;
        })
        .catch((error) => {
            logger.warn('[saveProject] CRDT persistence failed:', error);
            notifyUser('Save failed — your latest changes could not be persisted.', 'error');
            return false;
        });
}
