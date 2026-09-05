import { importAudioFile } from '#/modules/Arrangement/useCases';
import { captureProjectTransitionAuthority, pickFiles } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleImportAudioFile = createHandler<'importAudioFile'>({
    execute: () => {
        const authority = captureProjectTransitionAuthority();
        pickFiles({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }] })
            .then((files) => {
                if (files && authority.isCurrent()) {
                    for (const file of files) {
                        void importAudioFile(file, { shouldContinue: authority.isCurrent });
                    }
                }
                return null;
            })
            .catch(() => {
                notifyUser('Failed to open file dialog', 'error');
                return null;
            });
    },
    describe: () => ({ label: 'Import audio file' }),
    undoable: false,
});
