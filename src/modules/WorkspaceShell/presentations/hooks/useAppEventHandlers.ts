import { useEffect } from 'react';

import { type OpenPreferencesPayload } from '../../events/WorkspaceEvents';
import { onDialogOpenExport } from '../../useCases/dialogs/onDialogOpenExport';
import { onDialogOpenPreferences } from '../../useCases/dialogs/onDialogOpenPreferences';

type AppEventCallbacks = {
    onOpenExport: () => void;
    onOpenPreferences: (request: OpenPreferencesPayload) => void;
};

/**
 * Subscribes to typed EventBus events dispatched by menus and other parts of the app.
 */
export const useAppEventHandlers = ({ onOpenExport, onOpenPreferences }: AppEventCallbacks): void => {
    useEffect(() => {
        const unsubs = [
            onDialogOpenExport(() => onOpenExport()),
            onDialogOpenPreferences((request) => onOpenPreferences(request)),
        ];
        return () => {
            for (const unsub of unsubs) {
                unsub();
            }
        };
    }, [onOpenExport, onOpenPreferences]);
};
