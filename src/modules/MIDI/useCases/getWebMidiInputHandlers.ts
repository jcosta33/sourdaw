import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleDisableMpe } from '../handlers/webMidiInput/handleDisableMpe';
import { handleEnableMpe } from '../handlers/webMidiInput/handleEnableMpe';

type WebMidiInputAppAction = Extract<AppAction, { type: 'enableMpe' }> | Extract<AppAction, { type: 'disableMpe' }>;

export type WebMidiInputHandlersMap = {
    [Action in WebMidiInputAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges WebMIDI note-input `ActionHandler` maps (MPE toggle) for Command. Does
 * **not** call `createHandler` here.
 */
export function getWebMidiInputHandlers(): WebMidiInputHandlersMap {
    return {
        enableMpe: handleEnableMpe,
        disableMpe: handleDisableMpe,
    };
}
