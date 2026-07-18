import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectAndApplySongStructure } from '../../useCases/detectAndApplySongStructure';

export const handleDetectSongStructure = createHandler<'detectSongStructure'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        const sections = detectAndApplySongStructure(alpha.payload.trackId);
        if (sections.length === 0) {
            notifyUser('No clips found to analyze — add some clips first', 'warning');
        } else {
            notifyUser(
                `Detected ${sections.length} sections: ${sections.map((state) => state.name).join(', ')}`,
                'success'
            );
        }
    },
    // Not undoable: this handler captures no pre-state and returns no
    // inverseAction, so an undo entry could only no-op. Marking it non-undoable
    // keeps no-op entries off the undo/history stack.
    undoable: false,
    describe: () => ({ label: 'Detect Song Structure' }),
});
