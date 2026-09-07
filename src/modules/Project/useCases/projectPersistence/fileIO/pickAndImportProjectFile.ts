import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import { pickFiles } from '../../fileDialog';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { saveProject } from '../saveProject/saveProject';

import { applyImportedProjectData } from './applyImportedProjectData';

export async function pickAndImportProjectFile(): Promise<boolean> {
    const paths = await pickFiles({
        multiple: false,
        filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
    });

    if (!paths || paths.length === 0) {
        return false;
    }

    // Pre-save the open project before the import replaces it — otherwise
    // unsaved edits since the last save are silently lost (audit #568 F3). A
    // failed save (already notified) aborts the import so the current project
    // stays open. A save can also resolve while the project is still dirty — a
    // plugin state capture rejected before commit warns and stays retryable —
    // and importing over that uncaptured edit loses it all the same.
    if (projectStore.value?.dirty) {
        const saved = await saveProject();
        if (!saved || projectStore.value?.dirty === true) {
            return false;
        }
    }

    const transaction = runProjectLoadTransaction();

    try {
        const file = paths[0];
        if (!file) {
            return false;
        }
        const content = await file.text();
        const data: unknown = JSON.parse(content);

        const imported = await applyImportedProjectData({ data, transaction });
        if (!imported) {
            // `applyImportedProjectData` returns false for "the file was not
            // usable", for "a newer load superseded this one", and for "the
            // open destroyed the previous session and then failed". Only the
            // first is the file's fault, and only the first is worth retrying.
            // The last one has already told the user what happened and put a
            // failure surface on screen; blaming their file on top of that
            // sends them back to the picker while their session is gone.
            if (projectLoadFailureStore.value) {
                return false;
            }
            notifyUser('Invalid project file format', 'error');
            return false;
        }
        return true;
    } catch (error) {
        notifyUser('Failed to read project file', 'error');
        logger.error(new Error('Import error', { cause: error }));
        return false;
    }
}
