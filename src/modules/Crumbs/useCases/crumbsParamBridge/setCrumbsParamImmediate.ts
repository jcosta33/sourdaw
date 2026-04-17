import { logger } from '#/infra/logger/appLogger';
import { setCrumbsParam } from '../../repositories/crumbsBridge';

export function setCrumbsParamImmediate(instanceId: string, param: string, value: number): void {
    setCrumbsParam(instanceId, param, value).catch((err) => {
        logger.warn('Failed to set crumbs param:', err);
    });
}