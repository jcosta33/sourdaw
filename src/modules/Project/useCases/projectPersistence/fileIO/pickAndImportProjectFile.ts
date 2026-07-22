import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
    // stays open.
    if (projectStore.value?.dirty && !(await saveProject())) {
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

        const imported = await applyImportedProjectData({ data, transaction });
        if (!imported) {
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
