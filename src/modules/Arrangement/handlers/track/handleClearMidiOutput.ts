import { createHandler } from '#/utils/createHandler';

import { updateTrack } from '../../useCases/updateTrack';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (alpha) => {
        updateTrack(alpha.payload.trackId, (track) => ({ ...track, midiOutputTrackId: null }));
    },
    describe: () => ({ label: 'Clear MIDI Output' }),
    undoable: true,
});
