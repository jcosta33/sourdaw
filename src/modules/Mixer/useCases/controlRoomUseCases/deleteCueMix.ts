import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function deleteCueMix(cueId: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.filter((c) => c.id !== cueId),
        activeCueId: state.activeCueId === cueId ? null : state.activeCueId,
    });
}
