import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { importMidiFile } from '#/modules/Arrangement/useCases';
import { pickFiles } from '#/modules/Project';

export const handleImportMidiFile = createHandler<'importMidiFile'>({
    execute: () => {
        pickFiles({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] })
            .then((files) => {
                if (files) {
                    for (const file of files) {
                        importMidiFile(file);
                    }
                }
            })
            .catch(() => {
                notifyUser('Failed to open file dialog', 'error');
            });
    },
    describe: () => ({ label: 'Import MIDI file' }),
    undoable: false,
});
