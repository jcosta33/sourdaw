import { useEffect } from 'react';
import { APP_EVENTS } from '#/helpers/Event/appEvents';
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
            if (!window.confirm('Create a new project? Any unsaved changes will be lost.')) {
                return;
            }
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
        document.addEventListener(APP_EVENTS.OPEN_EXPORT, exportHandler);
        document.addEventListener(APP_EVENTS.OPEN_PREFERENCES, prefsHandler);
        document.addEventListener(APP_EVENTS.SAVE_PROJECT, saveHandler);
        document.addEventListener(APP_EVENTS.NEW_PROJECT, newHandler);
        document.addEventListener(APP_EVENTS.UNDO, undoHandler);
        document.addEventListener(APP_EVENTS.REDO, redoHandler);
        document.addEventListener(APP_EVENTS.IMPORT_MIDI, midiImportHandler);
        return () => {
            document.removeEventListener(APP_EVENTS.OPEN_EXPORT, exportHandler);
            document.removeEventListener(APP_EVENTS.OPEN_PREFERENCES, prefsHandler);
            document.removeEventListener(APP_EVENTS.SAVE_PROJECT, saveHandler);
            document.removeEventListener(APP_EVENTS.NEW_PROJECT, newHandler);
            document.removeEventListener(APP_EVENTS.UNDO, undoHandler);
            document.removeEventListener(APP_EVENTS.REDO, redoHandler);
            document.removeEventListener(APP_EVENTS.IMPORT_MIDI, midiImportHandler);
        };
    }, [onOpenExport, onOpenPreferences]);
};
