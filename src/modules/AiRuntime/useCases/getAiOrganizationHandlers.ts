import { handleAutoOrganizeProject } from '../handlers/aiOrganization/handleAutoOrganizeProject';
import { handleGetMentorTips } from '../handlers/aiOrganization/handleGetMentorTips';

export type AiOrganizationHandlersMap = {
    autoOrganizeProject: typeof handleAutoOrganizeProject;
    getMentorTips: typeof handleGetMentorTips;
};

/**
 * Merges AI organization `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAiOrganizationHandlers(): AiOrganizationHandlersMap {
    return {
        autoOrganizeProject: handleAutoOrganizeProject,
        getMentorTips: handleGetMentorTips,
    };
}
