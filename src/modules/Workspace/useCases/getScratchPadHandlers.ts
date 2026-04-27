import { handleCaptureScratchPad } from '../handlers/scratchPad/handleCaptureScratchPad';
import { handleToggleScratchPad } from '../handlers/scratchPad/handleToggleScratchPad';

export type ScratchPadHandlersMap = {
    toggleScratchPad: typeof handleToggleScratchPad;
    captureScratchPad: typeof handleCaptureScratchPad;
};

/**
 * Merges scratch-pad `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getScratchPadHandlers(): ScratchPadHandlersMap {
    return {
        toggleScratchPad: handleToggleScratchPad,
        captureScratchPad: handleCaptureScratchPad,
    };
}
