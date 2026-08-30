import { captureProjectRevision, compactProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { projectStore } from '../../stores/projectStore';
import { getRecentProjects } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';

import { captureProjectTransitionAuthority } from './captureProjectTransitionAuthority';
import { getProjectSnapshotKey } from './getProjectSnapshotKey';
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

    const snapshotKey = getProjectSnapshotKey(project.createdAt);
    const hasRecentEntry = getRecentProjects().some((entry) => entry.key === snapshotKey);
    const transitionAuthority = captureProjectTransitionAuthority();
    const transitionWasCurrent = transitionAuthority.isCurrent();
    const projectRevision = captureProjectRevision();
    const stillOwnsDiscard = (): boolean => {
        const current = projectStore.value;
        return (
            current === project &&
            (!transitionWasCurrent || transitionAuthority.isCurrent()) &&
            captureProjectRevision() === projectRevision
        );
    };
    let snapshot: string | null;
    try {
        snapshot = await readNamedProjectJson(snapshotKey);
    } catch {
        return notifyDiscardFailure('Could not verify the last saved project state. Your changes were not discarded.');
    }

    // Snapshot IO yields. Never let a stale close request replace the project a
    // musician selected while that read was in flight.
    if (!stillOwnsDiscard()) {
        return notifyDiscardFailure(
            'The active project changed before its saved state was verified. Close was cancelled.'
        );
    }

    if (snapshot !== null) {
        const restored =
            (await loadRecentProject(snapshotKey, { requireDurable: true, shouldProceed: stillOwnsDiscard })) ===
            'committed';
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

    if (!stillOwnsDiscard()) {
        return notifyDiscardFailure('The active project changed before it could be replaced. Close was cancelled.');
    }

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
