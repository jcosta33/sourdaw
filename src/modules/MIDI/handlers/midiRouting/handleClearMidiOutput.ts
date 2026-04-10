import { createHandler } from '#/helpers/createHandler';
import { clearMidiOutput } from '../../useCases/midiRouting';

export const handleClearMidiOutput = createHandler<'clearMidiOutput'>({
    execute: (a) => {
        clearMidiOutput(a.payload.trackId);
    },
    describe: () => ({ label: 'Clear MIDI Output' }),
    undoable: true,
});
