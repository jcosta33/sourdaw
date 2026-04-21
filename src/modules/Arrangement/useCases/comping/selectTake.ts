import { takeLaneStore } from '../../stores/takeLaneStore';

export function selectTake(trackId: string, takeId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.map((length) =>
            length.trackId === trackId
                ? {
                      ...length,
                      takes: length.takes.map((time) => ({
                          ...time,
                          selected: time.id === takeId,
                      })),
                  }
                : length
        ),
    });
}
