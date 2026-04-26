import { createHandler } from '#/utils/createHandler';

import { toggleChordTrack } from '../../useCases/chordTrack/toggleChordTrack';

export const handleToggleChordTrack = createHandler<'toggleChordTrack'>({
    execute: (alpha) => {
        toggleChordTrack(alpha.payload?.enabled);
    },
    describe: () => ({ label: 'Toggle chord track' }),
    undoable: false,
});
