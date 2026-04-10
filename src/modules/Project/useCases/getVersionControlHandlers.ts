import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { handleCreateProjectVersion } from '../handlers/versionControl/handleCreateProjectVersion';
import { handleCreateVersionBranch } from '../handlers/versionControl/handleCreateVersionBranch';
import { handleRestoreProjectVersion } from '../handlers/versionControl/handleRestoreProjectVersion';

type VersionControlAppAction =
    | Extract<AppAction, { type: 'createProjectVersion' }>
    | Extract<AppAction, { type: 'restoreProjectVersion' }>
    | Extract<AppAction, { type: 'createVersionBranch' }>;

export type VersionControlHandlersMap = {
    [Action in VersionControlAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges version-control `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getVersionControlHandlers(): VersionControlHandlersMap {
    return {
        createProjectVersion: handleCreateProjectVersion,
        restoreProjectVersion: handleRestoreProjectVersion,
        createVersionBranch: handleCreateVersionBranch,
    };
}
