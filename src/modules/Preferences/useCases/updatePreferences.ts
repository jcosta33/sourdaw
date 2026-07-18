import { setSoloMode } from '#/modules/WorkspaceShell/useCases';

import { defaultPreferences, type Preferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

type UpdatePreferencesInput = {
    patch: Partial<Preferences>;
};

export function updatePreferences({ patch }: UpdatePreferencesInput): void {
    const current_preferences = preferencesStore.value ?? defaultPreferences;
    const next_preferences = { ...current_preferences, ...patch };

    preferencesStore.set(next_preferences);

    if (patch.soloMode !== undefined) {
        setSoloMode(patch.soloMode);
    }
}
