import { type AppActionType } from '#/utils/handlerContract';

import { getAppActionExecutionPolicy } from './getAppActionExecutionPolicy';

type AppActionTypeInput = {
    type: AppActionType;
};

export function requiresAppActionConfirmation(actions: readonly AppActionTypeInput[]): boolean {
    if (actions.length > 1) {
        return true;
    }

    return actions.some((action) => getAppActionExecutionPolicy(action.type).requiresConfirmation);
}
