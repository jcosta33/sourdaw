import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleRepairProjectData } from '../handlers/project/handleRepairProjectData';
import { handleSetProductionBrief } from '../handlers/project/handleSetProductionBrief';
import { handleCreateProjectFromTemplate } from '../handlers/projectTemplate/handleCreateProjectFromTemplate';

type ProjectAppAction = Extract<
    AppAction,
    { type: 'createProjectFromTemplate' | 'repairProjectData' | 'setProductionBrief' }
>;

type ProjectHandlersMap = {
    [Action in ProjectAppAction as Action['type']]: ActionHandler<Action>;
};

export function getProjectHandlers(): ProjectHandlersMap {
    return {
        createProjectFromTemplate: handleCreateProjectFromTemplate,
        repairProjectData: handleRepairProjectData,
        setProductionBrief: handleSetProductionBrief,
    };
}
