import { preferencesStore } from '#/modules/Workspace/stores';
import { gridSnapBeats } from '#/modules/Workspace/useCases';

export function getGridSnap(): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeats(prefs.gridSubdivision);
}
