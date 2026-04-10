import { createHandler } from '#/helpers/createHandler';
import { humanizeNotes } from '#/modules/MIDI';

export const handleHumanizeNotes = createHandler<'humanizeNotes'>({
    execute: (a) => {
        humanizeNotes(a.payload.clipId, a.payload.amount);
    },
    describe: () => ({ label: 'Humanize notes' }),
    undoable: true,
});
