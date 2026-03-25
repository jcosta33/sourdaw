import { useEffect } from 'react';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { newProject } from '#/modules/Project/useCases/projectPersistence/newProject';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';

type AppEventCallbacks = {
    onOpenExport: () => void;
    onOpenPreferences: () => void;
};

/**
 * Subscribes to custom DOM events dispatched by menus and other parts of the app
 * (e.g. `webdaw:open-export`, `webdaw:save-project`).
 */
export const useAppEventHandlers = ({ onOpenExport, onOpenPreferences }: AppEventCallbacks): void => {
    useEffect(() => {
        const exportHandler = (): void => onOpenExport();
        const prefsHandler = (): void => onOpenPreferences();
        const saveHandler = (): void => saveProject();
        const newHandler = (): void => {
            newProject();
            window.location.reload();
        };
        const undoHandler = (): void => {
            void undo();
        };
        const redoHandler = (): void => {
            void redo();
        };
        const midiImportHandler = (e: Event): void => {
            const file = (e as CustomEvent<File>).detail;
            if (file) {
                void importMidiFile(file);
            }
        };
        document.addEventListener('webdaw:open-export', exportHandler);
        document.addEventListener('webdaw:open-preferences', prefsHandler);
        document.addEventListener('webdaw:save-project', saveHandler);
        document.addEventListener('webdaw:new-project', newHandler);
        document.addEventListener('webdaw:undo', undoHandler);
        document.addEventListener('webdaw:redo', redoHandler);
        document.addEventListener('webdaw:import-midi', midiImportHandler);
        return () => {
            document.removeEventListener('webdaw:open-export', exportHandler);
            document.removeEventListener('webdaw:open-preferences', prefsHandler);
            document.removeEventListener('webdaw:save-project', saveHandler);
            document.removeEventListener('webdaw:new-project', newHandler);
            document.removeEventListener('webdaw:undo', undoHandler);
            document.removeEventListener('webdaw:redo', redoHandler);
            document.removeEventListener('webdaw:import-midi', midiImportHandler);
        };
    }, [onOpenExport, onOpenPreferences]);
};
