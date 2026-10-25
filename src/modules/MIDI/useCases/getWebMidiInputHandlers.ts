import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleAppendOverdubControllers } from '../handlers/overdubControllers/handleAppendOverdubControllers';
import { handleRemoveOverdubControllers } from '../handlers/overdubControllers/handleRemoveOverdubControllers';
import { handleDisableMpe } from '../handlers/webMidiInput/handleDisableMpe';
import { handleEnableMpe } from '../handlers/webMidiInput/handleEnableMpe';

type WebMidiInputAppAction =
    | Extract<AppAction, { type: 'appendOverdubControllers' }>
    | Extract<AppAction, { type: 'disableMpe' }>
    | Extract<AppAction, { type: 'enableMpe' }>
    | Extract<AppAction, { type: 'removeOverdubControllers' }>;

export type WebMidiInputHandlersMap = {
    [Action in WebMidiInputAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges WebMIDI note-input `ActionHandler` maps (MPE toggle, the controller rows
 * an overdub pass records) for Command. Does **not** call `createHandler` here.
 */
export function getWebMidiInputHandlers(): WebMidiInputHandlersMap {
    return {
        appendOverdubControllers: handleAppendOverdubControllers,
        disableMpe: handleDisableMpe,
        enableMpe: handleEnableMpe,
        removeOverdubControllers: handleRemoveOverdubControllers,
    };
}
