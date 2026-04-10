import { getTrackStoreState, groupTracks, renameTrack, setTrackColor } from '#/modules/Arrangement';

type AiOrganizationHandlerDescription = {
    label: string;
};

type AiOrganizationHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => AiOrganizationHandlerDescription;
    undoable: boolean;
};

type AutoOrganizeProjectAction = {
    type: 'autoOrganizeProject';
    payload: {
        tracks: Array<{
            trackId: string;
            newName?: string;
            color?: string;
            folderName?: string;
        }>;
    };
};

type AiOrganizationHandlers = {
    autoOrganizeProject: AiOrganizationHandler<AutoOrganizeProjectAction>;
};

export const aiOrganizationHandlers: AiOrganizationHandlers = {
    autoOrganizeProject: {
        execute: async (a) => {
            const trackState = getTrackStoreState();
            if (!trackState) {
                return;
            }

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
    },
};
