import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { gridSnapBeats } from '#/modules/Workspace/models/Preferences';

function getGridSnap(): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeats(prefs.gridSubdivision);
}

export function snapToGrid(beat: number): number {
    const snap = getGridSnap();
    if (snap === 0) {
        return beat;
    }
    return Math.round(beat / snap) * snap;
}

export { getGridSnap };
