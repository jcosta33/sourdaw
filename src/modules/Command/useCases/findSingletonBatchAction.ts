import { type AppAction } from '#/utils/handlerContract';

import { getHandler } from '../stores/handlerRegistry';

export function findSingletonBatchAction(actions: readonly AppAction[]): AppAction | null {
    if (actions.length <= 1) {
        return null;
    }
    const explicitDomainSingleton = actions.find(
        (action) => getHandler(action)?.batchRestriction === 'domain-singleton'
    );
    if (explicitDomainSingleton) {
        return explicitDomainSingleton;
    }
    return actions.find((action) => getHandler(action)?.batchExecution === 'singleton') ?? null;
}
