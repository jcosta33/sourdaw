import { createHandler } from '#/utils/createHandler';

import { updateTrack } from '../../useCases/updateTrack';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (a) => {
        updateTrack(a.payload.trackId, (t) => ({ ...t, midiOutputTrackId: null }));
    },
    describe: () => ({ label: 'Clear MIDI Output' }),
    undoable: true,
});
