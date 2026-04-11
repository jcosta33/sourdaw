import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

export function selectTake(trackId: string, takeId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
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
}
