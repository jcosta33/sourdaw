import { captureProjectIdentity, compactProject } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { projectStore } from '../../stores/projectStore';
import { getRecentProjects } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';

import { captureProjectTransitionAuthority } from './captureProjectTransitionAuthority';
import { getProjectSnapshotKey } from './getProjectSnapshotKey';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
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
    // Allocated before the first read, in the same turn as the epoch capture:
    // transitions win by creation order, so a transition the user starts while
    // the discard reads gets a higher id and supersedes it even if it prepares
    // and activates after the checks below. A transaction allocated only for the
    // saved-copy load would let such a transition lose to the discard.
    const transaction = runProjectLoadTransaction();
    const projectIdentity = captureProjectIdentity();
    // Identity, not revision: Don't Save already discards every edit, and the
    // native close request is only honoured while the document is unchanged from
    // the dialog. The discard's own writes (the stop's transport halt, the
    // replacement's `loading` publication, a closing take's commit) move the
    // revision and the store object, and must never refuse it; only another
    // project, which moves the document identity, does.
    const stillOwnsProject = (): boolean =>
        projectStore.value?.createdAt === project.createdAt && captureProjectIdentity() === projectIdentity;
    // Checked only before this discard's load transaction prepares. Its
    // prepare() claims the newest epoch, so the captured one reads as superseded
    // by the discard itself; from then on the transaction's own supersession is
    // what detects a newer transition.
    const stillOwnsDiscard = (): boolean =>
        stillOwnsProject() && (!transitionWasCurrent || transitionAuthority.isCurrent());
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
            (await loadRecentProject(snapshotKey, {
                outgoingProject: 'discard',
                requireDurable: true,
                shouldProceed: stillOwnsProject,
                transaction,
            })) === 'committed';
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
        if (!(await newProject('Untitled Project', { outgoingProject: 'discard' }))) {
            return freshReplacementFailure();
        }
    } catch {
        return freshReplacementFailure();
    }

    return settleFreshReplacement();
}

async function settleFreshReplacement(): Promise<boolean> {
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
