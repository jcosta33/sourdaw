import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { detectAndApplySongStructure } from '#/modules/Arrangement';
import { type ActionHandler } from '#/modules/Command';

export const executeDetectSongStructure = inject({ detectAndApplySongStructure, notifyUser })(
    ({ detectAndApplySongStructure, notifyUser }) =>
        async function executeDetectSongStructure(a: { payload: { trackId?: string } }): Promise<void> {
            const sections = detectAndApplySongStructure(a.payload.trackId);
            if (sections.length === 0) {
                notifyUser('No clips found to analyze — add some clips first', 'warning');
            } else {
                notifyUser(
                    `Detected ${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`,
                    'success'
                );
            }
        }
);

export const songStructureHandlers: Record<string, ActionHandler<any>> = {
    detectSongStructure: {
        execute: executeDetectSongStructure,
        undoable: true,
        describe: () => ({ label: 'Detect Song Structure' }),
    },
};
