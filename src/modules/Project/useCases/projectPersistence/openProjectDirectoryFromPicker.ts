import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { isCanonicalProjectId } from '../../models/ProjectData';
import {
    beginProjectDirectorySelection,
    bindProjectDirectoryRoot,
} from '../../repositories/project/projectDirectoryBinding';
import { projectStore } from '../../stores/projectStore';
import { addToRecentProjects } from '../recentProjects/addToRecentProjects';

import { getProjectSnapshotKey } from './getProjectSnapshotKey';
import { loadProject } from './loadProject';
import { pendingProjectReplacements } from './pendingProjectReplacements';
import { prepareProjectDirectoryRead } from './projectDirectoryRead';
import { saveProjectBeforeReplacement } from './saveProject/saveProjectBeforeReplacement';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';

/** Open a saved project folder through the same validated CRDT authority path as Recent and boot. */
export async function openProjectDirectoryFromPicker(): Promise<boolean> {
    let selection: Promise<FileSystemDirectoryHandle>;
    try {
        selection = beginProjectDirectorySelection();
        void selection.catch(() => undefined);
    } catch (error) {
        notifyUser('Project folder selection is unavailable.', 'error');
        logger.error(new Error('Project folder selection failed', { cause: error }));
        return false;
    }
    const isStillChosen = pendingProjectReplacements.capture();
    if (projectStore.value?.dirty && !(await saveProjectBeforeReplacement())) {
        return false;
    }
    const transaction = runProjectLoadTransaction();
    try {
        const root = await selection;
        if (!isStillChosen()) {
            return false;
        }
        if (!isCanonicalProjectId(root.name)) {
            throw new Error('Choose the project folder inside the projects directory');
        }
        const binding = { projectId: root.name, recentKey: '', root };
        const directory = await prepareProjectDirectoryRead(
            binding,
            () => transaction.canActivate() && isStillChosen()
        );
        if (!isStillChosen()) {
            return false;
        }
        const loaded = await loadProject({ directory, transaction, explicit: true, shouldProceed: isStillChosen });
        if (!loaded) {
            return false;
        }
        const recentKey = getProjectSnapshotKey(directory.createdAt);
        try {
            await bindProjectDirectoryRoot(directory.projectId, root, recentKey);
            addToRecentProjects(directory.projectName, recentKey);
        } catch (error) {
            logger.warn('Opened project folder could not be remembered:', error);
            notifyUser('Project opened, but this browser could not remember its folder.', 'warning');
        }
        return true;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return false;
        }
        logger.error(new Error('Project folder could not be opened', { cause: error }));
        notifyUser('Could not open the project folder.', 'error');
        return false;
    }
}
