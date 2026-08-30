import { useEffect } from 'react';

import { preferencesStore } from '#/modules/Preferences/stores';

import { applyDisplayScale } from '../../useCases/applyDisplayScale';

export function useDisplayScaleSynchronization(): void {
    useEffect(() => {
        const syncDisplayScale = (): void => {
            const scale = preferencesStore.value?.uiScale ?? 1;
            applyDisplayScale(scale);
        };

        syncDisplayScale();
        return preferencesStore.subscribe(syncDisplayScale);
    }, []);
}
