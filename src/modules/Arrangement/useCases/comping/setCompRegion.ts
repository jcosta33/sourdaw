import { pushUndoEntry } from '#/modules/Command/useCases';

import { type CompRegion } from '../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function setCompRegion(trackId: string, region: CompRegion): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    if (!state.lanes.some((l) => l.trackId === trackId)) {
        return;
    }

    const previous: TakeLaneStoreState = state;
    const next: TakeLaneStoreState = {
        lanes: state.lanes.map((l) => {
            if (l.trackId !== trackId) {
                return l;
            }

            const filtered = l.activeCompRegions.filter(
                (r) => r.endBeat <= region.startBeat || r.startBeat >= region.endBeat
            );

            return {
                ...l,
                activeCompRegions: [...filtered, region].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat),
            };
        }),
    };
    takeLaneStore.set(next);

    pushUndoEntry(
        'Set comp region',
        () => takeLaneStore.set(previous),
        () => takeLaneStore.set(next)
    );
}
