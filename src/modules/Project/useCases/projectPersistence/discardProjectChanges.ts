import { notifyUser } from '#/utils/Notification/notifyUser';

import { NAMED_PROJECT_KEY_PREFIX } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';
import { getRecentProjects } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';

import { newProject } from './newProject';

/** Restore the active project's last explicit save, without persisting its current edits. */
export async function discardProjectChanges(): Promise<boolean> {
    const project = projectStore.value;
    if (!project) {
        return false;
    }

    const snapshotKey = `${NAMED_PROJECT_KEY_PREFIX}${project.createdAt}`;
    const hasNamedSnapshot = getRecentProjects().some((entry) => entry.key === snapshotKey);
    const restored = hasNamedSnapshot ? (await loadRecentProject(snapshotKey)) === 'committed' : await newProject();

    if (restored && projectStore.value?.dirty === false) {
        return true;
    }

    notifyUser(
        hasNamedSnapshot
            ? 'Could not restore the last saved project state. Your changes were not discarded.'
            : 'Could not create a fresh project. Your changes were not discarded.',
        'error'
    );
    return false;
}
