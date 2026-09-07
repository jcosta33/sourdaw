import { logger } from '#/infra/logger/appLogger';

import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { writeProjectJson } from '../../repositories/project/writeProjectJson';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../projectPersistence/helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../projectPersistence/helpers/replaceProjectData';
import {
    runProjectLoadTransaction,
    type ProjectLoadTransaction,
} from '../projectPersistence/helpers/runProjectLoadTransaction';

/**
 * Why a recent-project load ended the way it did. Callers must distinguish
 * these before reacting: 'not-found' is the only definitive-dead-entry
 * outcome (safe to prune), 'failed' is transient/corrupt-data (notify, keep
 * the entry), and 'aborted' means a newer transition superseded this load
 * (do nothing — the successor owns the project now).
 */
export type LoadRecentProjectOutcome = 'committed' | 'not-found' | 'failed' | 'aborted';

type LoadRecentProjectOptions = {
    /** A recovery path may only accept a load whose CRDT snapshot compacted. */
    readonly requireDurable?: boolean;
    /** A discard caller keeps this true only while its captured project authority is still current. */
    readonly shouldProceed?: () => boolean;
};

function isTransitionSuperseded(transaction: ProjectLoadTransaction, shouldProceed?: () => boolean): boolean {
    return (
        transaction.signal.aborted || !transaction.canActivate() || (shouldProceed !== undefined && !shouldProceed())
    );
}

export async function loadRecentProject(
    key: string,
    { requireDurable = false, shouldProceed }: LoadRecentProjectOptions = {}
): Promise<LoadRecentProjectOutcome> {
    const transaction = runProjectLoadTransaction();
    let raw: string | null;
    try {
        // Reads IndexedDB, the only store project content is written to. A
        // pre-ADR-0013 localStorage mirror wins only when it proves it is newer
        // by `meta.updatedAt` — never merely by being present, which is what
        // used to hand back a snapshot frozen at the moment the project first
        // exceeded quota.
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

    if (shouldProceed !== undefined && !shouldProceed()) {
        return 'aborted';
    }

    let result: Awaited<ReturnType<typeof replaceProjectData>>;
    try {
        result = await replaceProjectData({
            afterCommit: () => writeProjectJson(JSON.stringify(data)),
            context: 'loadRecentProject',
            data,
            shouldProceed,
            transaction,
        });
    } catch (error) {
        logger.error(new Error('Failed to replace project data', { cause: error }));
        return isTransitionSuperseded(transaction, shouldProceed) ? 'aborted' : 'failed';
    }

    if (result.status === 'committed') {
        return requireDurable && !result.durable ? 'failed' : 'committed';
    }
    if (result.status === 'failed') {
        return 'failed';
    }
    return isTransitionSuperseded(transaction, shouldProceed) ? 'aborted' : 'failed';
}
