import { useEffect } from 'react';
import { eventBus } from '#/app/registerDependencies';
import { saveProject } from '#/modules/Project/useCases/projectPersistence/saveProject';
import { newProject } from '#/modules/Project/useCases/projectPersistence/newProject';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';

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
            eventBus.on('dialog.openExport', () => onOpenExport()),
            eventBus.on('dialog.openPreferences', () => onOpenPreferences()),
            eventBus.on('project.save', () => saveProject()),
            eventBus.on('project.new', () => {
                if (!window.confirm('Create a new project? Any unsaved changes will be lost.')) {
                    return;
                }
                newProject();
                window.location.reload();
            }),
            eventBus.on('command.undo', () => {
                void undo();
            }),
            eventBus.on('command.redo', () => {
                void redo();
            }),
            eventBus.on('midi.import', (payload) => {
                if (payload.file) {
                    void importMidiFile(payload.file);
                }
            }),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, [onOpenExport, onOpenPreferences]);
};
