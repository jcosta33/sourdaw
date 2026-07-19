import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleCommitPitchEdit } from '../handlers/pitch/handleCommitPitchEdit';
import { handleRestoreClipFileId } from '../handlers/pitch/handleRestoreClipFileId';

type PitchAppAction =
    Extract<AppAction, { type: 'commitPitchEdit' }> | Extract<AppAction, { type: 'restoreClipFileId' }>;

export type PitchHandlersMap = {
    [Action in PitchAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges pitch-edit `ActionHandler` maps for Command. Does **not** call `createHandler`
 * here — the handlers own that. `restoreClipFileId` is the inverse emitted by
 * `handleCommitPitchEdit.describe()`, so both must be registered together.
 */
export function getPitchHandlers(): PitchHandlersMap {
    return {
        commitPitchEdit: handleCommitPitchEdit,
        restoreClipFileId: handleRestoreClipFileId,
    };
}
