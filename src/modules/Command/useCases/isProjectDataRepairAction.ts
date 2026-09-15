import type { AppAction } from '#/utils/handlerContract';

const PROJECT_DATA_REPAIR_ACTION_TYPE = 'repairProjectData';

export function isProjectDataRepairAction(action: AppAction): boolean {
    return action.type === PROJECT_DATA_REPAIR_ACTION_TYPE;
}
