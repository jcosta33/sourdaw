import { logger } from '#/infra/logger/appLogger';
import { crumbsAllSoundOff } from '../../repositories/crumbsBridge';

export async function allSoundOff(instanceId: string): Promise<void> {
    try {
        await crumbsAllSoundOff(instanceId);
    } catch (err) {
        logger.warn('All sound off failed:', err);
    }
}
