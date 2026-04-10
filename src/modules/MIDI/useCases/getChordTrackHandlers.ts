import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { handleAddChordEvent } from '../handlers/chordTrack/handleAddChordEvent';
import { handleClearChordTrack } from '../handlers/chordTrack/handleClearChordTrack';
import { handleRemoveChordEvent } from '../handlers/chordTrack/handleRemoveChordEvent';
import { handleToggleChordTrack } from '../handlers/chordTrack/handleToggleChordTrack';

type ChordTrackAppAction =
    | Extract<AppAction, { type: 'addChordEvent' }>
    | Extract<AppAction, { type: 'removeChordEvent' }>
    | Extract<AppAction, { type: 'toggleChordTrack' }>
    | Extract<AppAction, { type: 'clearChordTrack' }>;

export type ChordTrackHandlersMap = {
    [Action in ChordTrackAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges chord-track `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getChordTrackHandlers(): ChordTrackHandlersMap {
    return {
        addChordEvent: handleAddChordEvent,
        removeChordEvent: handleRemoveChordEvent,
        toggleChordTrack: handleToggleChordTrack,
        clearChordTrack: handleClearChordTrack,
    };
}
