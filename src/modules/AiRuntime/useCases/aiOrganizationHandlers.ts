import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { setTrackColor } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import { groupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/groupTracks';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeAutoOrganizeProject = inject({ getTrackStoreState, renameTrack, setTrackColor, groupTracks })(
    ({ getTrackStoreState, renameTrack, setTrackColor, groupTracks }) =>
        async function executeAutoOrganizeProject(a: Extract<AppAction, 'autoOrganizeProject'>): Promise<void> {
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
        }
);

export const aiOrganizationHandlers = {
    autoOrganizeProject: {
        execute: executeAutoOrganizeProject,
        describe: () => ({ label: 'Auto-Organize Project' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'autoOrganizeProject'>>,
};
