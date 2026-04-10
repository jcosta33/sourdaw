import { createHandler } from '#/helpers/createHandler';
import { clearChordTrack } from '../../useCases/chordTrack/clearChordTrack';

export const handleClearChordTrack = createHandler<'clearChordTrack'>({
    execute: () => {
        clearChordTrack();
    },
    describe: () => ({ label: 'Clear chord track' }),
    undoable: true,
});
