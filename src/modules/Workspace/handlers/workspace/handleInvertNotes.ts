import { createHandler } from '#/utils/createHandler';
import { invertNotes } from '#/modules/MIDI/useCases';

export const handleInvertNotes = createHandler<'invertNotes'>({
    execute: (a) => {
        invertNotes(a.payload.clipId);
    },
    describe: () => ({ label: 'Invert notes' }),
    undoable: true,
});
