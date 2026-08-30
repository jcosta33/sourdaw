import { compactProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { NAMED_PROJECT_KEY_PREFIX } from '../../models/ProjectData';
import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { projectStore } from '../../stores/projectStore';
import { getRecentProjects } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';

import { newProject } from './newProject';

const notifyDiscardFailure = (message: string): false => {
    notifyUser(message, 'error');
    return false;
};

/** Restore the active project's last explicit save, without persisting its current edits. */
export async function discardProjectChanges(): Promise<boolean> {
    const project = projectStore.value;
    if (!project) {
        return false;
    }

    const snapshotKey = `${NAMED_PROJECT_KEY_PREFIX}${project.createdAt}`;
    const hasRecentEntry = getRecentProjects().some((entry) => entry.key === snapshotKey);
    let snapshot: string | null;
    try {
        snapshot = await readNamedProjectJson(snapshotKey);
    } catch {
        return notifyDiscardFailure('Could not verify the last saved project state. Your changes were not discarded.');
    }

    if (snapshot !== null) {
        const restored = (await loadRecentProject(snapshotKey, { requireDurable: true })) === 'committed';
        if (restored && projectStore.value?.dirty === false) {
            return true;
        }
        return notifyDiscardFailure('Could not restore the last saved project state. Your changes were not discarded.');
    }

    if (hasRecentEntry) {
        return notifyDiscardFailure('The last saved project snapshot is unavailable. Your changes were not discarded.');
    }

    const freshReplacementFailure = (): false => {
        const current = projectStore.value;
        return notifyDiscardFailure(
            current?.projectId !== project.projectId
                ? 'The replacement project could not be created safely. Reload Sourdaw to recover it; close was cancelled.'
                : 'Could not create a fresh project. Your changes were not discarded.'
        );
    };

    try {
        if (!(await newProject())) {
            return freshReplacementFailure();
        }
    } catch {
        return freshReplacementFailure();
    }

    const replacement = projectStore.value;
    if (!replacement?.projectId) {
        return notifyDiscardFailure(
            'The replacement project could not be activated. Reload Sourdaw to recover it; close was cancelled.'
        );
    }

    if (replacement.identityPersistencePending) {
        try {
            await compactProject();
        } catch {
            return notifyDiscardFailure(
                'The replacement project could not be persisted. Reload Sourdaw to recover it; close was cancelled.'
            );
        }
    }

    const current = projectStore.value;
    if (!current || current.projectId !== replacement.projectId || current.dirty !== false) {
        return notifyDiscardFailure(
            'The replacement project changed before it was persisted. Reload Sourdaw to recover it; close was cancelled.'
        );
    }
    if (current.identityPersistencePending) {
        projectStore.set({ ...current, identityPersistencePending: false });
    }
    return true;
}
