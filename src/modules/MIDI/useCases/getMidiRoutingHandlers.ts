import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';

import { handleClearMidiOutput } from '../handlers/midiRouting/handleClearMidiOutput';
import { handleSetMidiOutput } from '../handlers/midiRouting/handleSetMidiOutput';

type MidiRoutingAppAction =
    | Extract<AppAction, { type: 'setMidiOutput' }>
    | Extract<AppAction, { type: 'clearMidiOutput' }>;

export type MidiRoutingHandlersMap = {
    [Action in MidiRoutingAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges MIDI-routing `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getMidiRoutingHandlers(): MidiRoutingHandlersMap {
    return {
        setMidiOutput: handleSetMidiOutput,
        clearMidiOutput: handleClearMidiOutput,
    };
}
