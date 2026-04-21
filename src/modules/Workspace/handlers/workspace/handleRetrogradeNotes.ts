import { retrogradeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRetrogradeNotes = createHandler<'retrogradeNotes'>({
    execute: (alpha) => {
        retrogradeNotes(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Retrograde notes' }),
    undoable: true,
});
