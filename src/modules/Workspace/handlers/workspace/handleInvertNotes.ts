import { invertNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleInvertNotes = createHandler<'invertNotes'>({
    execute: (alpha) => {
        invertNotes(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Invert notes' }),
    undoable: true,
});
