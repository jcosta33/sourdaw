import { createHandler } from '#/utils/createHandler';

import { clearChordTrack } from '../../useCases/chordTrack/clearChordTrack';

import { describeChordTrackMutation } from './handleRestoreChordTrackState';

export const handleClearChordTrack = createHandler<'clearChordTrack'>({
    execute: () => {
        clearChordTrack();
    },
    describe: (action) => describeChordTrackMutation(action, 'Clear chord track'),
    undoable: true,
});
