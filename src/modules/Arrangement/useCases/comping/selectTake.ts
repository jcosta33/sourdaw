import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';

export function selectTake(trackId: string, takeId: string): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = takeLaneStore.value;
        if (!state) {
            return;
        }

        const lane = state.lanes.find((l) => l.trackId === trackId);
        if (!lane) {
            return;
        }
        const alreadySelected = lane.takes.find((t) => t.selected);
        if (alreadySelected?.id === takeId) {
            return;
        }

        const previous: TakeLaneStoreState = state;
        const next: TakeLaneStoreState = {
            lanes: state.lanes.map((l) =>
                l.trackId === trackId
                    ? {
                          ...l,
                          takes: l.takes.map((t) => ({
                              ...t,
                              selected: t.id === takeId,
                          })),
                      }
                    : l
            ),
        };
        takeLaneStore.set(next);

        pushUndoEntry(
            'Select take',
            () => takeLaneStore.set(previous),
            () => takeLaneStore.set(next)
        );
    });
}
