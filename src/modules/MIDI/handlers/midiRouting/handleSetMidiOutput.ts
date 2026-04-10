import { createHandler } from '#/helpers/createHandler';
import { setMidiOutput } from '../../useCases/midiRouting';

export const handleSetMidiOutput = createHandler<'setMidiOutput'>({
    execute: (a) => {
        setMidiOutput(a.payload.trackId, a.payload.destinationTrackId);
    },
    describe: () => ({ label: 'Set MIDI Output' }),
    undoable: true,
});
