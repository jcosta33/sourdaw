import { createHandler } from '#/utils/createHandler';

import { clearMidiOutput } from '../../useCases/midiRouting/clearMidiOutput';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (alpha) => {
        clearMidiOutput(alpha.payload.trackId);
    },
    describe: () => ({ label: 'Clear MIDI Output' }),
    undoable: true,
});
