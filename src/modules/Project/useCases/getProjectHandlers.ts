import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleCreateProjectFromTemplate } from '../handlers/projectTemplate/handleCreateProjectFromTemplate';

type ProjectAppAction = Extract<AppAction, { type: 'createProjectFromTemplate' }>;

type ProjectHandlersMap = {
    [Action in ProjectAppAction as Action['type']]: ActionHandler<Action>;
};

export function getProjectHandlers(): ProjectHandlersMap {
    return { createProjectFromTemplate: handleCreateProjectFromTemplate };
}
