import { humanizeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (alpha) => {
        humanizeNotes(alpha.payload.clipId, alpha.payload.amount);
    },
    describe: () => ({ label: 'Humanize notes' }),
    undoable: true,
});
