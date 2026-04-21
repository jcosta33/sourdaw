import { pushUndoEntry } from '#/modules/Command/useCases';

import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function flattenComp(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    if (!state.lanes.some((l) => l.trackId === trackId)) {
        return;
    }

    const previous: TakeLaneStoreState = state;
    const next: TakeLaneStoreState = {
        lanes: state.lanes.filter((l) => l.trackId !== trackId),
    };
    takeLaneStore.set(next);

    pushUndoEntry(
        'Flatten comp',
        () => takeLaneStore.set(previous),
        () => takeLaneStore.set(next)
    );
}
