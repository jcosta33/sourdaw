import { createHandler } from '#/utils/createHandler';

import { removeChordEvent } from '../../useCases/chordTrack/removeChordEvent';

import {
    describeChordTrackMutation,
    findChordTrackRefusal,
    isChordTrackMutationNoop,
    isChordTrackSessionEntry,
} from './handleRestoreChordTrackState';

export const handleRemoveChordEvent = createHandler<'removeChordEvent'>({
    execute: (alpha) => {
        removeChordEvent(alpha.payload.eventId);
    },
    describe: (action, context) => describeChordTrackMutation(action, 'Remove chord event', context),
    validate: (action, context) => findChordTrackRefusal(action, context) === null,
    validationRefusalReason: findChordTrackRefusal,
    isNoop: isChordTrackMutationNoop,
    validateSessionEntry: isChordTrackSessionEntry,
    undoable: true,
});
