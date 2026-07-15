import { logger } from '#/infra/logger/appLogger';

import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../projectPersistence/helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../projectPersistence/helpers/replaceProjectData';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';

export async function loadRecentProject(key: string): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    let raw: string | null;
    try {
        // Reads localStorage first, then falls back to IndexedDB so projects
        // whose localStorage dual-write was dropped on quota stay loadable.
        raw = await readNamedProjectJson(key);
    } catch (error) {
        logger.error(new Error('Failed to read recent project', { cause: error }));
        return false;
    }

    if (!raw) {
        logger.warn(`No project data found for key: ${key}`);
        return false;
    }

    let data: unknown;
    try {
        data = normalizeLegacyProjectData(JSON.parse(raw));
    } catch (error) {
        logger.error(new Error('Failed to parse or normalize recent project', { cause: error }));
        return false;
    }

    if (!isHydratableProjectData(data)) {
        logger.warn(`Unsupported project version for key: ${key}`);
        return false;
    }

    const result = await replaceProjectData({
        afterCommit: () => writeProjectJson(JSON.stringify(data)),
        context: 'loadRecentProject',
        data,
        transaction,
    });
    return result.status === 'committed';
}
