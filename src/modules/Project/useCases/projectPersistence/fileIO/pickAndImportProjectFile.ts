import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { isSupportedProjectVersion, type ProjectData } from '../../../models/ProjectData';
import { pickFiles } from '../../fileDialog';

import { applyImportedProjectData } from './applyImportedProjectData';

export async function pickAndImportProjectFile(): Promise<boolean> {
    const paths = await pickFiles({
        multiple: false,
        filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
    });

    if (!paths || paths.length === 0) {
        return false;
    }

    try {
        const file = paths[0];
        if (!file) {
            return false;
        }
        const content = await file.text();
        const data = JSON.parse(content) as ProjectData;

        if (!isSupportedProjectVersion(data.version) || !data.arrangement?.tracks || !data.meta) {
            notifyUser('Invalid project file format', 'error');
            return false;
        }

        return await applyImportedProjectData(data);
    } catch (error) {
        notifyUser('Failed to read project file', 'error');
        logger.error(new Error('Import error', { cause: error }));
        return false;
    }
}
