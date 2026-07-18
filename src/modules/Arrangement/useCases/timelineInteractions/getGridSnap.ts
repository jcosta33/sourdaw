import { preferencesStore } from '#/modules/Preferences/stores';
import { gridSnapBeats } from '#/modules/Preferences/useCases';

export function getGridSnap(): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeats(prefs.gridSubdivision);
}
