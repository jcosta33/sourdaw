import { defaultPreferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

import { setSoloMode } from './togglePanel/panelToggles/setSoloMode';

export function resetPreferences(): void {
    preferencesStore.set(defaultPreferences);
    setSoloMode(defaultPreferences.soloMode);
}
