import { logger } from '#/infra/logger/appLogger';

import { compactProject } from './compactProject';
import { resetCrdtProjectAuthority } from './resetCrdtProjectAuthority';

/**
 * Create a new CRDT-backed project.
 */
export async function createCrdtProject(name: string): Promise<{ status: 'committed' | 'committed-degraded' }> {
    resetCrdtProjectAuthority(name);
    try {
        await compactProject();
        return { status: 'committed' };
    } catch (error) {
        logger.warn('[createCrdtProject] Project identity committed but initial compaction failed:', error);
        return { status: 'committed-degraded' };
    }
}
