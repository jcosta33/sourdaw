import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import { setTrackColor } from '#/modules/Track/useCases/setTrackGainPan';
import { renameTrack } from '#/modules/Track/useCases/renameTrack';
import { groupTracks } from '#/modules/Track/useCases/toggleTrackState';
import { getTrackStoreState } from '#/modules/Track/useCases/trackQueries';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const aiOrganizationHandlers = {
    autoOrganizeProject: {
        execute: async (a) => {
            const trackState = getTrackStoreState();
            if (!trackState) return;

            // Group requested folders to avoid creating duplicates
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

            // Execute track grouping
            for (const [folderName, trackIds] of folderGroups.entries()) {
                groupTracks(trackIds, folderName);
            }
        },
        describe: () => ({ label: 'Auto-Organize Project' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'autoOrganizeProject'>>,
};
