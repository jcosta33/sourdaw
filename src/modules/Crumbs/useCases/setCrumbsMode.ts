/**
 * Switch crumbs operating mode (Quick/Drum/Slice/Warp).
 * Updates both the store and the backend engine.
 */

import { logger } from '#/infra/logger/appLogger';
import type { CrumbsMode } from '../models/CrumbsTypes';
import { setCrumbsMode } from '../repositories/crumbsBridge';
import { setMode } from '../stores/crumbsStore';

export async function switchCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    setMode(instanceId, mode);
    try {
        await setCrumbsMode(instanceId, mode);
    } catch (err) {
        logger.warn('Failed to crumbs mode:', err);
    }
}
