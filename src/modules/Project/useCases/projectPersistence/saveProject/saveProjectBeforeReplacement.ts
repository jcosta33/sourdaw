import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { type OutgoingProjectDisposition } from '../helpers/resetCrdtProjectWithTransportStopped';

import { saveProject } from './saveProject';

/** What a project-replacing route does next: replace with this disposition, or stay. */
type PreReplacementDisposition = OutgoingProjectDisposition | 'stay';

/**
 * Whether the user is in a project they could choose to leave. A load in flight
 * has not settled which project is open, and after a failed load the store
 * still names a project whose session is gone; discarding there would replace
 * the copy a reload restores.
 */
function hasLeavableProject(): boolean {
    const project = projectStore.value;
    return project !== null && !project.loading && projectLoadFailureStore.value === null;
}

/**
 * Ask whether to leave a project with changes that could not be saved, as
 * every DAW does when a save before closing fails: Don't Save drops them and
 * Cancel stays. A choice made about one project never applies to another, so a
 * project switch, load or load failure while the dialog is open (the native
 * menu can start one) answers `stay`.
 */
async function confirmLeavingUnsavedProject(): Promise<PreReplacementDisposition> {
    const project = projectStore.value;
    const projectIdentity = captureProjectIdentity();
    const projectName = project?.name ?? 'this project';
    const leave = await confirmUser({
        title: `Leave "${projectName}" without saving?`,
        message: `Some changes to "${projectName}" could not be saved. If you continue, they are lost.`,
        confirmLabel: "Don't Save",
        cancelLabel: 'Cancel',
        variant: 'danger',
    });
    if (!leave) {
        return 'stay';
    }
    const stillSameProject =
        hasLeavableProject() &&
        projectStore.value?.createdAt === project?.createdAt &&
        captureProjectIdentity() === projectIdentity;
    return stillSameProject ? 'discard' : 'stay';
}

/**
 * Run the pre-switch save a project-replacing route owes the open project, and
 * decide what the replacement owes it.
 *
 * A save that keeps the project clean answers `save-closed-takes`, the
 * replacement's default. A failed save, or one that resolved while the project
 * is still dirty, asks the user whether to leave without saving. A save can
 * resolve `true` while the project is still dirty: a plugin state capture
 * rejected before commit warns the user, leaves that edit out of the persisted
 * truth, and holds the dirty flag so the next save retries (issue #3694).
 * Replacing the project over it would destroy the edit exactly as a failed save
 * would, so both ask. Don't Save answers `discard`, so the replacement neither
 * saves the outgoing project again nor reports a closed take as lost; Cancel
 * answers `stay`, and the project stays open. Without a project the user could
 * leave (a load in flight or failed), it answers `stay` without asking.
 */
export async function saveProjectBeforeReplacement(): Promise<PreReplacementDisposition> {
    const saved = await saveProject();
    if (saved && projectStore.value?.dirty !== true) {
        return 'save-closed-takes';
    }
    if (!hasLeavableProject()) {
        return 'stay';
    }
    return confirmLeavingUnsavedProject();
}
