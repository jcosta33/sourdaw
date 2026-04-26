import { controlRoomStore } from '../../stores/controlRoom';

export function deleteCueMix(cueId: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        cueMixes: state.cueMixes.filter((context) => context.id !== cueId),
        activeCueId: state.activeCueId === cueId ? null : state.activeCueId,
    });
}
