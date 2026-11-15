import { type AppAction } from '#/utils/handlerContract';

import { admitAppAction } from './admitAppAction';

/** Whether the dispatch gate would admit this action right now. */
export function isAppActionAdmitted(action: AppAction): boolean {
    return admitAppAction(action).admitted;
}
