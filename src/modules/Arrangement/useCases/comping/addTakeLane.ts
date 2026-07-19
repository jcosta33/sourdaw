import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { createTakeLane } from '../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function addTakeLane(trackId: string): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = takeLaneStore.value;
        if (!state) {
            return;
        }

        const exists = state.lanes.some((length) => length.trackId === trackId);
        if (exists) {
            return;
        }

        const previous: TakeLaneStoreState = state;
        const next: TakeLaneStoreState = {
            lanes: [...state.lanes, createTakeLane(trackId)],
        };
        takeLaneStore.set(next);

        pushUndoEntry(
            'Add take lane',
            () => takeLaneStore.set(previous),
            () => takeLaneStore.set(next)
        );
    });
}
