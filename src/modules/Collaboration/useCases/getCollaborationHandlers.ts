import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleCreateCollabSession } from '../handlers/collaboration/handleCreateCollabSession';
import { handleJoinCollabSession } from '../handlers/collaboration/handleJoinCollabSession';
import { handleLeaveCollabSession } from '../handlers/collaboration/handleLeaveCollabSession';

type CollaborationAppAction =
    | Extract<AppAction, { type: 'createCollabSession' }>
    | Extract<AppAction, { type: 'joinCollabSession' }>
    | Extract<AppAction, { type: 'leaveCollabSession' }>;

export type CollaborationHandlersMap = {
    [Action in CollaborationAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges Collaboration `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getCollaborationHandlers(): CollaborationHandlersMap {
    return {
        createCollabSession: handleCreateCollabSession,
        joinCollabSession: handleJoinCollabSession,
        leaveCollabSession: handleLeaveCollabSession,
    };
}
