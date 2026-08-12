import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleSetProductionBrief } from '../handlers/project/handleSetProductionBrief';
import { handleCreateProjectFromTemplate } from '../handlers/projectTemplate/handleCreateProjectFromTemplate';

type ProjectAppAction = Extract<AppAction, { type: 'createProjectFromTemplate' | 'setProductionBrief' }>;

type ProjectHandlersMap = {
    [Action in ProjectAppAction as Action['type']]: ActionHandler<Action>;
};

export function getProjectHandlers(): ProjectHandlersMap {
    return {
        createProjectFromTemplate: handleCreateProjectFromTemplate,
        setProductionBrief: handleSetProductionBrief,
    };
}
