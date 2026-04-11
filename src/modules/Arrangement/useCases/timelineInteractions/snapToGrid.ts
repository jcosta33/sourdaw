import { preferencesStore } from '#/modules/Workspace/stores';
import { gridSnapBeats } from '#/modules/Workspace/useCases';

function computeGridSnap(gridSnapBeatsFn: typeof gridSnapBeats): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeatsFn(prefs.gridSubdivision);
}

export function getGridSnap(): number {
    return computeGridSnap(gridSnapBeats);
}

export function snapToGrid(beat: number): number {
    const snap = computeGridSnap(gridSnapBeats);
    if (snap === 0) {
        return beat;
    }
    return Math.round(beat / snap) * snap;
}
