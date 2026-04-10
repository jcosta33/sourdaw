import { createHandler } from '#/helpers/createHandler';
import { toggleChordTrack } from '../../useCases/chordTrack/toggleChordTrack';

export const handleToggleChordTrack = createHandler<'toggleChordTrack'>({
    execute: (a) => {
        toggleChordTrack(a.payload?.enabled);
    },
    describe: () => ({ label: 'Toggle chord track' }),
    undoable: false,
});
