import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { pickFiles } from '../../fileDialog';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { saveEditedProjectBeforeReplacement } from '../saveProject/saveEditedProjectBeforeReplacement';

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
    // unsaved edits since the last save are silently lost (audit #568 F3). The
    // guard refuses a failed save and a save that resolved with the project
    // still dirty (a plugin capture rejected before commit; both surfaces
    // already notified), so the current project stays open. A take a Stop is
    // still committing dirties the project only once it lands, so the check
    // follows the wait for it.
    if (!(await saveEditedProjectBeforeReplacement())) {
        return false;
    }

    const transaction = runProjectLoadTransaction();

    try {
        const file = paths[0];
        if (!file) {
            return false;
        }
        const content = await file.text();
        const data: unknown = JSON.parse(content);
        // A Stop pressed while the file was read lands its take in the project
        // the import is about to replace, after the pre-save above ran.
        if (!(await saveEditedProjectBeforeReplacement())) {
            return false;
        }

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
