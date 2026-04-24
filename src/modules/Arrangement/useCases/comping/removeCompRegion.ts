import { pushUndoEntry } from '#/modules/Command/useCases';

import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function removeCompRegion(trackId: string, startBeat: number): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId);
    if (!lane) {
        return;
    }
    if (!lane.activeCompRegions.some((r) => r.startBeat === startBeat)) {
        return;
    }

    const previous: TakeLaneStoreState = state;
    const next: TakeLaneStoreState = {
        lanes: state.lanes.map((l) => {
            if (l.trackId !== trackId) {
                return l;
            }
            return {
                ...l,
                activeCompRegions: l.activeCompRegions.filter((r) => r.startBeat !== startBeat),
            };
        }),
    };
    takeLaneStore.set(next);

    pushUndoEntry(
        'Remove comp region',
        () => takeLaneStore.set(previous),
        () => takeLaneStore.set(next)
    );
}
