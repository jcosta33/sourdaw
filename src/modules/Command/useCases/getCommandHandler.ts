import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { getHandler } from '../stores/handlerRegistry';

import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

export function getCommandHandler<ActionType extends AppAction['type']>(
    action: Extract<AppAction, { type: ActionType }>
): ActionHandler<Extract<AppAction, { type: ActionType }>> | undefined {
    if (isExecutableAppActionType(action.type)) {
        return getExecutableCommandRegistration(action.type).handler as ActionHandler<
            Extract<AppAction, { type: ActionType }>
        >;
    }
    return getHandler(action);
}
