import { importMidiFile } from '#/modules/Arrangement/useCases';
import { captureProjectTransitionAuthority, pickFiles } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleImportMidiFile = createHandler<'importMidiFile'>({
    execute: () => {
        const authority = captureProjectTransitionAuthority();
        pickFiles({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] })
            .then((files) => {
                if (files && authority.isCurrent()) {
                    for (const file of files) {
                        void importMidiFile(file, { shouldContinue: authority.isCurrent });
                    }
                }
                return null;
            })
            .catch(() => {
                if (authority.isCurrent()) {
                    notifyUser('Failed to open file dialog', 'error');
                }
                return null;
            });
    },
    describe: () => ({ label: 'Import MIDI file' }),
    undoable: false,
});
