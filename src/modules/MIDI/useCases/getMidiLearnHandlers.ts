import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleClearAllMappings } from '../handlers/midiLearn/handleClearAllMappings';

type MidiLearnAppAction = Extract<AppAction, { type: 'clearAllMidiMappings' }>;

export type MidiLearnHandlersMap = {
    [Action in MidiLearnAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges MIDI Learn `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getMidiLearnHandlers(): MidiLearnHandlersMap {
    return {
        clearAllMidiMappings: handleClearAllMappings,
    };
}
