import { createHandler } from '#/utils/createHandler';

import { removeChordEvent } from '../../useCases/chordTrack/removeChordEvent';

import { describeChordTrackMutation, isChordTrackMutationNoop } from './handleRestoreChordTrackState';

export const handleRemoveChordEvent = createHandler<'removeChordEvent'>({
    execute: (alpha) => {
        removeChordEvent(alpha.payload.eventId);
    },
    describe: (action) => describeChordTrackMutation(action, 'Remove chord event'),
    isNoop: isChordTrackMutationNoop,
    undoable: true,
});
