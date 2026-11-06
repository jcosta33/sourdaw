import { useEffect } from 'react';

import { preferencesStore } from '#/modules/Preferences/stores';

export function useThemeSynchronization(): void {
    useEffect(() => {
        const syncTheme = (): void => {
            const theme = preferencesStore.value?.theme ?? 'dark';
            document.documentElement.classList.toggle('dark', theme === 'dark');
            document.documentElement.classList.toggle('light', theme === 'light');
        };

        syncTheme();
        return preferencesStore.subscribe(syncTheme);
    }, []);
}
