import { useEffect } from 'react';
import { importMidiFile } from '#/modules/Arrangement/useCases';
import { saveProject, newProject } from '#/modules/Project';
import { undo, redo } from '#/modules/Command/useCases';
import { onDialogOpenExport } from '../../useCases/dialogs/onDialogOpenExport';
import { onDialogOpenPreferences } from '../../useCases/dialogs/onDialogOpenPreferences';
import { onProjectSave } from '../../useCases/appEventSubscribers/onProjectSave';
import { onProjectNew } from '../../useCases/appEventSubscribers/onProjectNew';
import { onCommandUndo } from '../../useCases/appEventSubscribers/onCommandUndo';
import { onCommandRedo } from '../../useCases/appEventSubscribers/onCommandRedo';
import { onMidiImport } from '../../useCases/appEventSubscribers/onMidiImport';

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
