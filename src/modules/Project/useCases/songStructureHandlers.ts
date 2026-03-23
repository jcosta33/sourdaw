import { type ActionHandler } from '#/modules/Command/models/ActionHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { detectAndApplySongStructure } from '#/modules/Timeline/useCases/songStructureDetection';

export const songStructureHandlers: Record<string, ActionHandler<any>> = {
    detectSongStructure: {
        execute: async (a: { payload: { trackId?: string } }) => {
            const sections = detectAndApplySongStructure(a.payload.trackId);
            if (sections.length === 0) {
                notifyUser('No clips found to analyze — add some clips first', 'warning');
            } else {
                notifyUser(`Detected ${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`, 'success');
            }
        },
        undoable: true,
        describe: () => ({ label: 'Detect Song Structure' }),
    },
};
