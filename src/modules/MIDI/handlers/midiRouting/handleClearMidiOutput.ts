import { createHandler } from '#/utils/createHandler';

import { clearMidiOutput } from '../../useCases/midiRouting/clearMidiOutput';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (a) => {
        clearMidiOutput(a.payload.trackId);
    },
    describe: () => ({ label: 'Clear MIDI Output' }),
    undoable: true,
});
