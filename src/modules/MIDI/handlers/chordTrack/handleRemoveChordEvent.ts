import { createHandler } from '#/utils/createHandler';

import { removeChordEvent } from '../../useCases/chordTrack/removeChordEvent';

export const handleRemoveChordEvent = createHandler<'removeChordEvent'>({
    execute: (alpha) => {
        removeChordEvent(alpha.payload.eventId);
    },
    describe: () => ({ label: 'Remove chord event' }),
    undoable: true,
});
