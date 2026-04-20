import { logger } from '#/infra/logger/appLogger';

import { crumbsAllSoundOff } from '../../repositories/crumbsBridge';

export async function allSoundOff(instanceId: string): Promise<void> {
    try {
        await crumbsAllSoundOff(instanceId);
    } catch (error) {
        logger.warn('All sound off failed:', error);
    }
}
