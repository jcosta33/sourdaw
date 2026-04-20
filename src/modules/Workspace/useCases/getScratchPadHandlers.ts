import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleCaptureScratchPad } from '../handlers/scratchPad/handleCaptureScratchPad';
import { handleClearScratchPad } from '../handlers/scratchPad/handleClearScratchPad';
import { handleCommitScratchPad } from '../handlers/scratchPad/handleCommitScratchPad';
import { handleToggleScratchPad } from '../handlers/scratchPad/handleToggleScratchPad';

type ScratchPadAppAction =
    | Extract<AppAction, { type: 'toggleScratchPad' }>
    | Extract<AppAction, { type: 'captureScratchPad' }>
    | Extract<AppAction, { type: 'commitScratchPad' }>
    | Extract<AppAction, { type: 'clearScratchPad' }>;

export type ScratchPadHandlersMap = {
    [Action in ScratchPadAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges scratch-pad `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getScratchPadHandlers(): ScratchPadHandlersMap {
    return {
        toggleScratchPad: handleToggleScratchPad,
        captureScratchPad: handleCaptureScratchPad,
        commitScratchPad: handleCommitScratchPad,
        clearScratchPad: handleClearScratchPad,
    };
}
