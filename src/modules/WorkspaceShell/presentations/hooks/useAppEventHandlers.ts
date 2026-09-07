import { useEffect } from 'react';

import { importMidiFile } from '#/modules/Arrangement/useCases';
import { undo, redo } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority, saveProject, newProject } from '#/modules/Project/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { onCommandRedo } from '../../useCases/appEventSubscribers/onCommandRedo';
import { onCommandUndo } from '../../useCases/appEventSubscribers/onCommandUndo';
import { onMidiImport } from '../../useCases/appEventSubscribers/onMidiImport';
import { onProjectNew } from '../../useCases/appEventSubscribers/onProjectNew';
import { onProjectSave } from '../../useCases/appEventSubscribers/onProjectSave';
import { onDialogOpenExport } from '../../useCases/dialogs/onDialogOpenExport';
import { onDialogOpenPreferences } from '../../useCases/dialogs/onDialogOpenPreferences';

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
            onProjectSave(() => {
                // Fire-and-forget: saveProject notifies the user itself on failure.
                void saveProject();
            }),
            onProjectNew(() => {
                void (async () => {
                    const ok = await confirmUser({
                        title: 'New project',
                        message: 'Create a new project? Any unsaved changes will be lost.',
                        confirmLabel: 'New project',
                        variant: 'danger',
                    });
                    if (!ok) {
                        return;
                    }
                    void newProject();
                    window.location.reload();
                })();
            }),
            onCommandUndo(() => {
                void undo();
            }),
            onCommandRedo(() => {
                void redo();
            }),
            onMidiImport((payload) => {
                if (payload.file) {
                    const authority = captureProjectTransitionAuthority();
                    void importMidiFile(payload.file, { shouldContinue: authority.isCurrent });
                }
            }),
        ];
        return () => {
            for (const unsub of unsubs) {
                unsub();
            }
        };
    }, [onOpenExport, onOpenPreferences]);
};
