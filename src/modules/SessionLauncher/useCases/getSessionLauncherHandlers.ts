import { handleToggleLoopRecord } from '../handlers/sessionLauncher/handleToggleLoopRecord';
import { handleTriggerScene } from '../handlers/sessionLauncher/handleTriggerScene';

export type SessionLauncherHandlersMap = {
    toggleLoopRecord: typeof handleToggleLoopRecord;
    triggerScene: typeof handleTriggerScene;
};

/**
 * Merges Session Launcher `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 * These are the loop-station command handlers folded out of Transport in ADR-0011 W4.
 */
export function getSessionLauncherHandlers(): SessionLauncherHandlersMap {
    return {
        toggleLoopRecord: handleToggleLoopRecord,
        triggerScene: handleTriggerScene,
    };
}
