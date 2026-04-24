import { createHandler } from '#/utils/createHandler';

import { setMidiOutput } from '../../useCases/midiRouting/setMidiOutput';

export const handleSetMidiOutput = createHandler<'setMidiOutput'>({
    execute: (alpha) => {
        setMidiOutput(alpha.payload.trackId, alpha.payload.destinationTrackId);
    },
    describe: () => ({ label: 'Set MIDI Output' }),
    undoable: true,
});
