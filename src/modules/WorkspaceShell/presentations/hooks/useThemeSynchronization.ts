import { useEffect } from 'react';

import { preferencesStore } from '#/modules/Preferences/stores';
import { applyDocumentTheme } from '#/utils/UI/applyDocumentTheme';

export function useThemeSynchronization(): void {
    useEffect(() => {
        const syncTheme = (): void => {
            applyDocumentTheme(preferencesStore.value?.theme ?? 'dark');
        };

        syncTheme();
        return preferencesStore.subscribe(syncTheme);
    }, []);
}
