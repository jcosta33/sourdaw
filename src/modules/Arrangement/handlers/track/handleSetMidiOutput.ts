import { createHandler } from '#/utils/createHandler';

import { updateTrack } from '../../useCases/updateTrack';

export const handleSetMidiOutput = createHandler<'setMidiOutput'>({
    execute: (a) => {
        updateTrack(a.payload.trackId, (t) => ({ ...t, midiOutputTrackId: a.payload.destinationTrackId }));
    },
    describe: () => ({ label: 'Set MIDI Output' }),
    undoable: true,
});
