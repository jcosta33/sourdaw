import { type AppAction } from '#/utils/handlerContract';

import { commandRequiresDynamicEffectsByActionType } from '../models/DynamicEffectOperationPolicy';

export function commandRequiresDynamicEffects(operation: AppAction['type']): boolean {
    return commandRequiresDynamicEffectsByActionType[operation];
}
