import { createHandler } from '#/helpers/createHandler';
import { retrogradeNotes } from '#/modules/MIDI';

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (a) => {
        retrogradeNotes(a.payload.clipId);
    },
    describe: () => ({ label: 'Retrograde notes' }),
    undoable: true,
});
