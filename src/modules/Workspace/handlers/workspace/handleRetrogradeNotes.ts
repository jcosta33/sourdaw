import { retrogradeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (a) => {
        retrogradeNotes(a.payload.clipId);
    },
    describe: () => ({ label: 'Retrograde notes' }),
    undoable: true,
});
