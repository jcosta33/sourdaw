import { getTrackStoreState, groupTracks, renameTrack, setTrackColor } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAutoOrganizeProject = createHandler<'autoOrganizeProject'>({
    execute: async (a) => {
        const trackState = getTrackStoreState();
        if (!trackState) {
            return;
        }

        const folderGroups = new Map<string, string[]>();

        for (const update of a.payload.tracks) {
            if (update.newName) {
                renameTrack(update.trackId, update.newName);
            }

            if (update.color) {
                setTrackColor(update.trackId, update.color);
            }

            if (update.folderName) {
                const group = folderGroups.get(update.folderName) ?? [];
                group.push(update.trackId);
                folderGroups.set(update.folderName, group);
            }
        }

        for (const [folderName, trackIds] of folderGroups.entries()) {
            groupTracks(trackIds, folderName);
        }
    },
    describe: () => ({ label: 'Auto-Organize Project' }),
    undoable: true,
});
