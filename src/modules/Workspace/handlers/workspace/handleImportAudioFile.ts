import { importAudioFile } from '#/modules/Arrangement/useCases';
import { pickFiles } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleImportAudioFile = createHandler<'importAudioFile'>({
    execute: () => {
        pickFiles({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }] })
            .then((files) => {
                if (files) {
                    for (const file of files) {
                        void importAudioFile(file);
                    }
                }
            })
            .catch(() => {
                notifyUser('Failed to open file dialog', 'error');
            });
    },
    describe: () => ({ label: 'Import audio file' }),
    undoable: false,
});
