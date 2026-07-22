import { logger } from '#/infra/logger/appLogger';

import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { writeProjectJson } from '../../repositories/project/writeProjectJson';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../projectPersistence/helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../projectPersistence/helpers/replaceProjectData';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';

/**
 * Why a recent-project load ended the way it did. Callers must distinguish
 * these before reacting: 'not-found' is the only definitive-dead-entry
 * outcome (safe to prune), 'failed' is transient/corrupt-data (notify, keep
 * the entry), and 'aborted' means a newer transition superseded this load
 * (do nothing — the successor owns the project now).
 */
export type LoadRecentProjectOutcome = 'committed' | 'not-found' | 'failed' | 'aborted';

export async function loadRecentProject(key: string): Promise<LoadRecentProjectOutcome> {
    const transaction = runProjectLoadTransaction();
    let raw: string | null;
    try {
        // Reads localStorage first, then falls back to IndexedDB so projects
        // whose localStorage dual-write was dropped on quota stay loadable.
        raw = await readNamedProjectJson(key);
    } catch (error) {
        logger.error(new Error('Failed to read recent project', { cause: error }));
        return 'failed';
    }

    if (!raw) {
        logger.warn(`No project data found for key: ${key}`);
        return 'not-found';
    }

    let data: unknown;
    try {
        data = normalizeLegacyProjectData(JSON.parse(raw));
    } catch (error) {
        logger.error(new Error('Failed to parse or normalize recent project', { cause: error }));
        return 'failed';
    }

    if (!isHydratableProjectData(data)) {
        logger.warn(`Unsupported project version for key: ${key}`);
        return 'failed';
    }

    const result = await replaceProjectData({
        afterCommit: () => writeProjectJson(JSON.stringify(data)),
        context: 'loadRecentProject',
        data,
        transaction,
    });
    return result.status === 'committed' ? 'committed' : 'aborted';
}
