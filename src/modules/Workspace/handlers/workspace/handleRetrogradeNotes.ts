import { createHandler } from '#/utils/createHandler';
import { retrogradeNotes } from '#/modules/MIDI/useCases';

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (a) => {
        retrogradeNotes(a.payload.clipId);
    },
    describe: () => ({ label: 'Retrograde notes' }),
    undoable: true,
});
