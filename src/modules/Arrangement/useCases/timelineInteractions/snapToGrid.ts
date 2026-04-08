import { inject } from '#/infra/di/inject';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { gridSnapBeats } from '#/modules/Workspace/useCases/workspaceQueries';

function computeGridSnap(gridSnapBeatsFn: typeof gridSnapBeats): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeatsFn(prefs.gridSubdivision);
}

export const getGridSnap = inject({ gridSnapBeats })(
    ({ gridSnapBeats }) =>
        function getGridSnap(): number {
            return computeGridSnap(gridSnapBeats);
        }
);

export const snapToGrid = inject({ gridSnapBeats })(
    ({ gridSnapBeats }) =>
        function snapToGrid(beat: number): number {
            const snap = computeGridSnap(gridSnapBeats);
            if (snap === 0) {
                return beat;
            }
            return Math.round(beat / snap) * snap;
        }
);
