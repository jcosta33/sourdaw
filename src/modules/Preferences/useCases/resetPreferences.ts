import { defaultPreferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

import { soloModePreferenceEvents } from './helpers/soloModePreferenceEvents';

export function resetPreferences(): void {
    preferencesStore.trySet(defaultPreferences);
    void soloModePreferenceEvents.emit('preferences.soloModeApplied', { soloMode: defaultPreferences.soloMode });
}
