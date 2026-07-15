import { handleDeleteMacro } from '../handlers/macro/handleDeleteMacro';
import { handlePlayMacro } from '../handlers/macro/handlePlayMacro';
import { handleRenameMacro } from '../handlers/macro/handleRenameMacro';
import { handleStartMacroRecording } from '../handlers/macro/handleStartMacroRecording';
import { handleStopMacroRecording } from '../handlers/macro/handleStopMacroRecording';
import { type AppAction } from '../models/AppAction';

import { type ActionHandler } from './executeAppAction';

type MacroAppAction =
    | Extract<AppAction, { type: 'startMacroRecording' }>
    | Extract<AppAction, { type: 'stopMacroRecording' }>
    | Extract<AppAction, { type: 'playMacro' }>
    | Extract<AppAction, { type: 'deleteMacro' }>
    | Extract<AppAction, { type: 'renameMacro' }>;

export type MacroHandlersMap = {
    [Action in MacroAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges macro `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getMacroHandlers(): MacroHandlersMap {
    return {
        startMacroRecording: handleStartMacroRecording,
        stopMacroRecording: handleStopMacroRecording,
        playMacro: handlePlayMacro,
        deleteMacro: handleDeleteMacro,
        renameMacro: handleRenameMacro,
    };
}
