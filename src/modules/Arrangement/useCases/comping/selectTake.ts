import { inject } from '#/infra/di/inject';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

export const selectTake = inject({ takeLaneStore })(({ takeLaneStore: store }) => {
    return function selectTake(trackId: string, takeId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        store.set({
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
        });
    };
});
