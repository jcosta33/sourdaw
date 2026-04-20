import { detectAndApplySongStructure } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleDetectSongStructure = createHandler<'detectSongStructure'>({
    execute: async (a) => {
        const sections = detectAndApplySongStructure(a.payload.trackId);
        if (sections.length === 0) {
            notifyUser('No clips found to analyze — add some clips first', 'warning');
        } else {
            notifyUser(`Detected ${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`, 'success');
        }
    },
    undoable: true,
    describe: () => ({ label: 'Detect Song Structure' }),
});
