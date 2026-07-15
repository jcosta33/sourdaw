import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { pickFiles } from '../../fileDialog';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';

import { applyImportedProjectData } from './applyImportedProjectData';

export async function pickAndImportProjectFile(): Promise<boolean> {
    const paths = await pickFiles({
        multiple: false,
        filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
    });

    if (!paths || paths.length === 0) {
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
