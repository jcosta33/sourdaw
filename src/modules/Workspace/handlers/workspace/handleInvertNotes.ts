import { invertNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleInvertNotes = createHandler<'invertNotes'>({
    execute: (a) => {
        invertNotes(a.payload.clipId);
    },
    describe: () => ({ label: 'Invert notes' }),
    undoable: true,
});
