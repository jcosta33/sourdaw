import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleAddChordEvent } from '../handlers/chordTrack/handleAddChordEvent';
import { handleClearChordTrack } from '../handlers/chordTrack/handleClearChordTrack';
import { handleRemoveChordEvent } from '../handlers/chordTrack/handleRemoveChordEvent';
import {
    handleMoveChordEvent,
    handleRestoreChordTrackState,
    handleUpdateChordEvent,
} from '../handlers/chordTrack/handleRestoreChordTrackState';
import { handleToggleChordTrack } from '../handlers/chordTrack/handleToggleChordTrack';

type ChordTrackAppAction =
    | Extract<AppAction, { type: 'addChordEvent' }>
    | Extract<AppAction, { type: 'moveChordEvent' }>
    | Extract<AppAction, { type: 'updateChordEvent' }>
    | Extract<AppAction, { type: 'removeChordEvent' }>
    | Extract<AppAction, { type: 'toggleChordTrack' }>
    | Extract<AppAction, { type: 'clearChordTrack' }>
    | Extract<AppAction, { type: 'restoreChordTrackState' }>;

export type ChordTrackHandlersMap = {
    [Action in ChordTrackAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges chord-track `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getChordTrackHandlers(): ChordTrackHandlersMap {
    return {
        addChordEvent: handleAddChordEvent,
        moveChordEvent: handleMoveChordEvent,
        updateChordEvent: handleUpdateChordEvent,
        removeChordEvent: handleRemoveChordEvent,
        toggleChordTrack: handleToggleChordTrack,
        clearChordTrack: handleClearChordTrack,
        restoreChordTrackState: handleRestoreChordTrackState,
    };
}
