import { notifyUser } from '#/helpers/Notification/notifyUser';
import { detectAndApplySongStructure } from '#/modules/Arrangement';

type ProjectHandlerResult = {
    label: string;
    inverseAction?: unknown | null;
};

type ProjectHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ProjectHandlerResult;
    undoable: boolean;
};

type DetectSongStructureAction = {
    type: 'detectSongStructure';
    payload: { trackId?: string };
};

export const songStructureHandlers = {
    detectSongStructure: {
        execute: async (a) => {
            const sections = detectAndApplySongStructure(a.payload.trackId);
            if (sections.length === 0) {
                notifyUser('No clips found to analyze — add some clips first', 'warning');
            } else {
                notifyUser(
                    `Detected ${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`,
                    'success'
                );
            }
        },
        undoable: true,
        describe: () => ({ label: 'Detect Song Structure' }),
    } satisfies ProjectHandler<DetectSongStructureAction>,
};
