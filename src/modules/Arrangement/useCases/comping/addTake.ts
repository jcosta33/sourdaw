import { pushUndoEntry } from '#/modules/Command/useCases';

import { createTake } from '../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function addTake(trackId: string, clipId: string, name: string, startBeat: number, endBeat: number): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const take = createTake(clipId, name, startBeat, endBeat);

    const previous: TakeLaneStoreState = state;
    const next: TakeLaneStoreState = {
        lanes: state.lanes.map((l) => (l.trackId === trackId ? { ...l, takes: [...l.takes, take] } : l)),
    };
    takeLaneStore.set(next);

    pushUndoEntry(
        `Add take: ${name}`,
        () => takeLaneStore.set(previous),
        () => takeLaneStore.set(next)
    );
}
