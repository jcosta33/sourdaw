import { setSoloMode } from '#/modules/WorkspaceShell/useCases';

import { defaultPreferences, type Preferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

type UpdatePreferencesInput = {
    patch: Partial<Preferences>;
};

export function updatePreferences({ patch }: UpdatePreferencesInput): void {
    const current_preferences = preferencesStore.value ?? defaultPreferences;
    const next_preferences = { ...current_preferences, ...patch };

    // `trySet`, not `set`. This runs from click handlers, and a refused write
    // used to throw out of one synchronously — `registerGlobalErrorHandlers`
    // only listens for `unhandledrejection`, so nothing caught it and the
    // interaction was discarded rather than merely unpersisted. On a full quota
    // the user could not switch `autoSave` on even for the current session.
    // The change applies now; the adapter reports the loss of durability once
    // per session, so this path stays silent per write. See #1557.
    preferencesStore.trySet(next_preferences);

    if (patch.soloMode !== undefined) {
        setSoloMode(patch.soloMode);
    }
}
