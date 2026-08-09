import { setSoloMode } from '#/modules/WorkspaceShell/useCases';

import { defaultPreferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

export function resetPreferences(): void {
    preferencesStore.trySet(defaultPreferences);
    setSoloMode(defaultPreferences.soloMode);
}
