import { createHandler } from '#/utils/createHandler';

import { clearChordTrack } from '../../useCases/chordTrack/clearChordTrack';

import {
    describeChordTrackMutation,
    findChordTrackRefusal,
    isChordTrackMutationNoop,
    isChordTrackSessionEntry,
} from './handleRestoreChordTrackState';

export const handleClearChordTrack = createHandler<'clearChordTrack'>({
    execute: () => {
        clearChordTrack();
    },
    describe: (action, context) => describeChordTrackMutation(action, 'Clear chord track', context),
    validate: (action, context) => findChordTrackRefusal(action, context) === null,
    validationRefusalReason: findChordTrackRefusal,
    isNoop: isChordTrackMutationNoop,
    validateSessionEntry: isChordTrackSessionEntry,
    undoable: true,
});
