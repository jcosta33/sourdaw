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
 * (e.g. `sourdaw:open-export`, `sourdaw:save-project`).
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
        document.addEventListener('sourdaw:open-export', exportHandler);
        document.addEventListener('sourdaw:open-preferences', prefsHandler);
        document.addEventListener('sourdaw:save-project', saveHandler);
        document.addEventListener('sourdaw:new-project', newHandler);
        document.addEventListener('sourdaw:undo', undoHandler);
        document.addEventListener('sourdaw:redo', redoHandler);
        document.addEventListener('sourdaw:import-midi', midiImportHandler);
        return () => {
            document.removeEventListener('sourdaw:open-export', exportHandler);
            document.removeEventListener('sourdaw:open-preferences', prefsHandler);
            document.removeEventListener('sourdaw:save-project', saveHandler);
            document.removeEventListener('sourdaw:new-project', newHandler);
            document.removeEventListener('sourdaw:undo', undoHandler);
            document.removeEventListener('sourdaw:redo', redoHandler);
            document.removeEventListener('sourdaw:import-midi', midiImportHandler);
        };
    }, [onOpenExport, onOpenPreferences]);
};
