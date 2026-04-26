import { detectAndApplySongStructure } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
    undoable: true,
    describe: () => ({ label: 'Detect Song Structure' }),
});
