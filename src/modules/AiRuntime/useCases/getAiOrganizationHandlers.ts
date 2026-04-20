import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleAutoOrganizeProject } from '../handlers/aiOrganization/handleAutoOrganizeProject';

type AiOrganizationAppAction = Extract<AppAction, { type: 'autoOrganizeProject' }>;

export type AiOrganizationHandlersMap = {
    [Action in AiOrganizationAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges AI organization `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAiOrganizationHandlers(): AiOrganizationHandlersMap {
    return {
        autoOrganizeProject: handleAutoOrganizeProject,
    };
}
