import { useEffect } from 'react';

import { preferencesStore } from '#/modules/Preferences/stores';
import { applyDocumentTheme } from '#/utils/UI/applyDocumentTheme';

export function useThemeSynchronization(): void {
    useEffect(() => {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
        const syncTheme = (): void => {
            const preference = preferencesStore.value?.theme ?? 'system';
            if (preference !== 'system') {
                applyDocumentTheme(preference);
                return;
            }
            applyDocumentTheme(systemTheme.matches ? 'dark' : 'light');
        };

        syncTheme();
        const unsubscribe = preferencesStore.subscribe(syncTheme);
        systemTheme.addEventListener('change', syncTheme);
        return () => {
            unsubscribe();
            systemTheme.removeEventListener('change', syncTheme);
        };
    }, []);
}
