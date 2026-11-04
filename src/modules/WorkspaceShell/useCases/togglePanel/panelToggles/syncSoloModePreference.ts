import { preferencesStore } from '#/modules/Preferences/stores';
import { onSoloModePreferenceApplied } from '#/modules/Preferences/useCases';

import { setSoloMode } from './setSoloMode';

export function syncSoloModePreference(): () => void {
    const unsubscribe = onSoloModePreferenceApplied(({ soloMode }) => {
        setSoloMode(soloMode);
    });
    const savedMode = preferencesStore.value?.soloMode;
    if (savedMode !== undefined) {
        setSoloMode(savedMode);
    }
    return unsubscribe;
}
