import { useEffect } from 'react';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { newProject } from '#/modules/Project/useCases/projectPersistence/newProject';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';
import { onDialogOpenExport, onDialogOpenPreferences } from '../../useCases/dialogs';
import { onProjectSave, onProjectNew, onCommandUndo, onCommandRedo, onMidiImport } from '../../useCases/appEventSubscribers';

type AppEventCallbacks = {
    onOpenExport: () => void;
    onOpenPreferences: () => void;
};

/**
 * Subscribes to typed EventBus events dispatched by menus and other parts of the app.
 */
export const useAppEventHandlers = ({ onOpenExport, onOpenPreferences }: AppEventCallbacks): void => {
    useEffect(() => {
        const unsubs = [
            onDialogOpenExport(() => onOpenExport()),
            onDialogOpenPreferences(() => onOpenPreferences()),
            onProjectSave(() => saveProject()),
            onProjectNew(() => {
                if (!window.confirm('Create a new project? Any unsaved changes will be lost.')) {
                    return;
                }
                newProject();
                window.location.reload();
            }),
            onCommandUndo(() => {
                undo();
            }),
            onCommandRedo(() => {
                redo();
            }),
            onMidiImport((payload) => {
                if (payload.file) {
                    importMidiFile(payload.file);
                }
            }),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, [onOpenExport, onOpenPreferences]);
};
