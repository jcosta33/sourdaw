import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';

import { handleRestoreDsoSnapshot } from '../handlers/snapshot/handleRestoreDsoSnapshot';

type DsoSnapshotAppAction = Extract<AppAction, { type: 'restoreDsoSnapshot' }>;

export type DsoSnapshotHandlersMap = {
    [Action in DsoSnapshotAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges DSO-snapshot `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getDsoSnapshotHandlers(): DsoSnapshotHandlersMap {
    return {
        restoreDsoSnapshot: handleRestoreDsoSnapshot,
    };
}
