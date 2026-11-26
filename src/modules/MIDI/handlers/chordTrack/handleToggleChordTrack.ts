import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { toggleChordTrack } from '../../useCases/chordTrack/toggleChordTrack';

import {
    describeChordTrackMutation,
    isChordTrackSessionEntry,
    findChordTrackRefusal,
} from './handleRestoreChordTrackState';

export const handleToggleChordTrack = createHandler<'toggleChordTrack'>({
    execute: (action) => {
        toggleChordTrack(action.payload.enabled);
    },
    describe: (action, context) => {
        const label = action.payload.enabled ? 'Enable chord track' : 'Disable chord track';
        return describeChordTrackMutation(action, label, context);
    },
    validate: (action, context) => findChordTrackRefusal(action, context) === null,
    validationRefusalReason: findChordTrackRefusal,
    isNoop: (action) => {
        const state = chordTrackStore.value;
        if (!state) {
            return true;
        }
        return action.payload.enabled === state.enabled;
    },
    validateSessionEntry: isChordTrackSessionEntry,
    undoable: true,
});
