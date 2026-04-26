import { createHandler } from '#/utils/createHandler';

import { updateTrack } from '../../useCases/updateTrack';

export const handleSetMidiOutput = createHandler<'setMidiOutput'>({
    execute: (alpha) => {
        updateTrack(alpha.payload.trackId, (track) => ({
            ...track,
            midiOutputTrackId: alpha.payload.destinationTrackId,
        }));
    },
    describe: () => ({ label: 'Set MIDI Output' }),
    undoable: true,
});
