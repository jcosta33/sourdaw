import { humanizeNotes } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (a) => {
        humanizeNotes(a.payload.clipId, a.payload.amount);
    },
    describe: () => ({ label: 'Humanize notes' }),
    undoable: true,
});
