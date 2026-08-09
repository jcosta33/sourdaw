import { type AppAction } from '#/utils/handlerContract';

import { getHandler } from '../stores/handlerRegistry';

export function findSingletonBatchAction(actions: readonly AppAction[]): AppAction | null {
    if (actions.length <= 1) {
        return null;
    }
    return actions.find((action) => getHandler(action)?.batchExecution === 'singleton') ?? null;
}
